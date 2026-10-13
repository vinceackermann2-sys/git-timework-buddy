import type Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { reserveAgentAi, responseOutputLimit } from './agentAiReservation.ts';
import { claudeKey, claudeRoute } from './claudeAgentAi.ts';
import { assertCloudSafe } from './privacy.ts';

// Claude behind the Responses API that the desktop's Codex speaks. Each request
// becomes a Messages API request and Claude's stream becomes Responses events.
// Claude's thinking blocks travel in reasoning items' encrypted_content, which
// Codex sends back unchanged, so later turns replay them exactly as written.
// Codex's history only grows, and the conversion keeps it that way, so the
// prompt cache holds and replayed thinking stays valid.

const THINKING_PREFIX = 'twclaude1.';
const THINKING_BINDING = 'thinking-binding-controls-2026-08-01';
const FAST_MODE = 'fast-mode-2026-02-01';
// The desktop offers low to max; Codex's other names map to the nearest level.
const EFFORTS: Record<string, string> = { none: 'low', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max', ultra: 'max' };
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const STREAM_LIMIT_MS = 300_000;

type Block = Record<string, any>;
type Message = { role: 'user' | 'assistant'; content: Block[] };
type ToolRef = { name: string; namespace?: string; custom: boolean };

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
const fromBase64 = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)));

export const encodeThinking = (blocks: Block[]) => THINKING_PREFIX + toBase64(JSON.stringify(blocks));
export function decodeThinking(value: unknown): Block[] | null {
  if (typeof value !== 'string' || !value.startsWith(THINKING_PREFIX)) return null;
  try {
    const blocks = JSON.parse(fromBase64(value.slice(THINKING_PREFIX.length)));
    const valid = (block: any) => (block?.type === 'thinking' && typeof block.thinking === 'string' && typeof block.signature === 'string')
      || (block?.type === 'redacted_thinking' && typeof block.data === 'string');
    return Array.isArray(blocks) && blocks.length && blocks.every(valid) ? blocks : null;
  } catch { return null; }
}
// Claude's thinking means nothing to OpenAI's models; their requests leave it out.
export const isClaudeReasoning = (item: any) => item?.type === 'reasoning' && typeof item.encrypted_content === 'string' && item.encrypted_content.startsWith(THINKING_PREFIX);

// Tool names may use letters, digits, "_" and "-", up to 64 characters. A tool
// in one of Codex's namespaces becomes "<namespace>__<name>"; anything else
// gets a stable short form.
function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}
function toolName(name: string, namespace?: string) {
  const flat = namespace ? `${namespace}__${name}` : name;
  return /^[a-zA-Z0-9_-]{1,64}$/.test(flat) ? flat : flat.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 55) + '_' + fnv(flat);
}
const callId = (value: unknown) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';

// Codex's function tools, its namespaced ones and its free-form tools (one
// string input). Hosted OpenAI tools such as web search are left out.
export function claudeTools(tools: unknown) {
  const list: Block[] = [], byClaude = new Map<string, ToolRef>(), byCodex = new Map<string, string>();
  const add = (tool: any, namespace?: string) => {
    if (!tool || typeof tool.name !== 'string' || !tool.name || (tool.type !== 'function' && tool.type !== 'custom')) return;
    const custom = tool.type === 'custom', name = toolName(tool.name, namespace);
    if (byClaude.has(name)) return;
    const grammar = custom && typeof tool.format?.definition === 'string' ? `\nIt must follow this ${tool.format.syntax || ''} grammar:\n${tool.format.definition}` : '';
    const schema = custom ? { type: 'object', properties: { input: { type: 'string', description: 'The raw input for this tool.' + grammar } }, required: ['input'] }
      : tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters) ? { ...tool.parameters, type: 'object' } : { type: 'object', properties: {} };
    list.push({ name, ...(tool.description ? { description: String(tool.description) } : {}), input_schema: schema });
    byClaude.set(name, { name: tool.name, ...(namespace ? { namespace } : {}), custom });
    byCodex.set(`${namespace || ''}\u0000${tool.name}`, name);
  };
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (tool?.type === 'namespace') for (const inner of Array.isArray(tool.tools) ? tool.tools : []) add(inner, tool.name);
    else add(tool);
  }
  return { list, byClaude, nameFor: (name: unknown, namespace?: unknown) => byCodex.get(`${namespace || ''}\u0000${name}`) || toolName(String(name ?? 'tool'), namespace ? String(namespace) : undefined) };
}

function attachment(url: unknown): Block | null {
  if (typeof url !== 'string') return null;
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (data) {
    if (IMAGE_TYPES.has(data[1])) return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
    return data[1] === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data[2] } } : null;
  }
  return /^https?:\/\//i.test(url) ? { type: 'image', source: { type: 'url', url } } : null;
}
function parts(content: unknown): Block[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const blocks: Block[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (['input_text', 'output_text', 'text'].includes(part?.type) && typeof part.text === 'string' && part.text) blocks.push({ type: 'text', text: part.text });
    else if (part?.type === 'refusal' && typeof part.refusal === 'string' && part.refusal) blocks.push({ type: 'text', text: part.refusal });
    else if (part?.type === 'input_image') blocks.push(attachment(part.image_url) || { type: 'text', text: '[An image that could not be attached]' });
    else if (part?.type === 'input_file') blocks.push(attachment(part.file_data) || { type: 'text', text: `[A file${part.filename ? ' named ' + part.filename : ''} that could not be attached]` });
  }
  return blocks;
}
const textOf = (content: unknown) => parts(content).filter(block => block.type === 'text').map(block => block.text).join('\n\n');
function toolInput(value: unknown) {
  try { const parsed = JSON.parse(String(value ?? '{}') || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch { /* Not JSON. */ }
  return { raw_arguments: String(value ?? '') };
}
function toolResult(output: unknown): string | Block[] {
  if (typeof output === 'string') return output || '(no output)';
  if (Array.isArray(output)) {
    const blocks = parts(output).filter(block => block.type === 'text' || block.type === 'image');
    return blocks.length ? blocks : '(no output)';
  }
  return output == null ? '(no output)' : JSON.stringify(output);
}
const isThinking = (block: Block) => block.type === 'thinking' || block.type === 'redacted_thinking';

// Every tool call needs its result in the next user turn, and results lead
// that turn. A call without a recorded result gets an error result; a result
// whose call isn't in the turn before becomes plain text.
function pairToolCalls(messages: Message[]) {
  const result: Message[] = [];
  const add = (message: Message) => {
    const last = result.at(-1);
    if (last?.role === message.role) last.content.push(...message.content); else result.push(message);
  };
  for (let at = 0; at < messages.length; at++) {
    const message = messages[at];
    if (message.role === 'assistant') {
      // A reply that stopped while still thinking has nothing to answer.
      if (message.content.every(isThinking)) continue;
      add(message);
      const calls = message.content.filter(block => block.type === 'tool_use').map(block => block.id);
      if (!calls.length) continue;
      if (messages[at + 1]?.role !== 'user') messages.splice(at + 1, 0, { role: 'user', content: [] });
      const next = messages[at + 1], answered = new Set(next.content.filter(block => block.type === 'tool_result').map(block => block.tool_use_id));
      for (const id of calls) if (!answered.has(id)) next.content.push({ type: 'tool_result', tool_use_id: id, content: 'No result was recorded for this call.', is_error: true });
      continue;
    }
    const previous = result.at(-1);
    const calls = new Set(previous?.role === 'assistant' ? previous.content.filter(block => block.type === 'tool_use').map(block => block.id) : []);
    const results: Block[] = [], rest: Block[] = [];
    for (const block of message.content) {
      if (block.type !== 'tool_result') rest.push(block);
      else if (calls.has(block.tool_use_id)) { results.push(block); calls.delete(block.tool_use_id); }
      else rest.push({ type: 'text', text: 'Result of an earlier tool call:\n' + (typeof block.content === 'string' ? block.content : textOf(block.content) || '(no text)') });
    }
    if (results.length || rest.length) add({ role: 'user', content: [...results, ...rest] });
  }
  // A conversation starts with the user and ends with the user or tool results.
  if (result[0]?.role !== 'user') result.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  if (result.at(-1)?.role !== 'user') result.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  return result;
}

// Codex's input items as Claude messages. Developer messages before the
// conversation starts join the system prompt; later ones (each message's
// context, a model change) reach Claude in the user's turn, where they were.
export function claudeMessages(input: unknown, instructions: unknown, tools: ReturnType<typeof claudeTools>) {
  const system: string[] = typeof instructions === 'string' && instructions.trim() ? [instructions] : [];
  const messages: Message[] = [];
  const append = (role: Message['role'], blocks: Block[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks); else messages.push({ role, content: [...blocks] });
  };
  for (const item of Array.isArray(input) ? input : []) {
    const type = item?.type ?? (item?.role ? 'message' : undefined);
    if (type === 'message') {
      if (item.role === 'developer' || item.role === 'system') {
        const text = textOf(item.content);
        if (text && !messages.length) system.push(text);
        else if (text) append('user', [{ type: 'text', text }]);
      } else append(item.role === 'assistant' ? 'assistant' : 'user', parts(item.content));
    } else if (type === 'reasoning') {
      const blocks = decodeThinking(item.encrypted_content);
      if (blocks) append('assistant', blocks);
    } else if (type === 'function_call') {
      append('assistant', [{ type: 'tool_use', id: callId(item.call_id), name: tools.nameFor(item.name, item.namespace), input: toolInput(item.arguments) }]);
    } else if (type === 'custom_tool_call') {
      append('assistant', [{ type: 'tool_use', id: callId(item.call_id), name: tools.nameFor(item.name, item.namespace), input: { input: String(item.input ?? '') } }]);
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      append('user', [{ type: 'tool_result', tool_use_id: callId(item.call_id), content: toolResult(item.output) }]);
    }
  }
  return { system, messages: pairToolCalls(messages) };
}

// The Messages API request for a Responses request. Thinking is adaptive with
// readable summaries (shown as the chat's thinking); effort comes from the
// picker. A replayed thinking block the API can no longer use is dropped
// rather than failing the request. The system prompt and the conversation so
// far are cached. Tools and the base instructions (the first system block)
// are the same in every chat on a model, so they get a breakpoint of their
// own; the last system block holds the chat's own context. With the
// conversation's automatic one that is at most 3 of the 4 allowed, all 5-minute.
export function claudeRequest(route: { model: string; fast: boolean }, body: any, userKey?: string) {
  const tools = claudeTools(body.tools);
  const { system, messages } = claudeMessages(body.input, body.instructions, tools);
  const effort = EFFORTS[body.reasoning?.effort];
  const params: Record<string, any> = {
    model: route.model,
    max_tokens: responseOutputLimit(body),
    messages,
    thinking: { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    cache_control: { type: 'ephemeral' },
    betas: route.fast ? [THINKING_BINDING, FAST_MODE] : [THINKING_BINDING],
    ...(system.length ? { system: system.map((text, at) => ({ type: 'text', text, ...(at === 0 || at === system.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) })) } : {}),
    ...(effort ? { output_config: { effort } } : {}),
    ...(tools.list.length ? { tools: tools.list, tool_choice: body.tool_choice === 'none' ? { type: 'none' } : { type: 'auto', disable_parallel_tool_use: body.parallel_tool_calls !== true } } : {}),
    ...(route.fast ? { speed: 'fast' } : {}),
    ...(userKey ? { metadata: { user_id: userKey } } : {}),
  };
  return { params, tools };
}

export function responsesUsage(usage: any) {
  const read = usage?.cache_read_input_tokens || 0, written = usage?.cache_creation_input_tokens || 0, output = usage?.output_tokens || 0;
  const input = (usage?.input_tokens || 0) + read + written;
  return { input_tokens: input, input_tokens_details: { cached_tokens: read, cache_write_tokens: written }, output_tokens: output, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: input + output };
}

const REFUSAL_TOPICS: Record<string, string> = { cyber: 'cybersecurity', bio: 'biology', frontier_llm: 'AI model development', reasoning_extraction: 'its hidden reasoning', general_harms: 'possible harm' };
const refusalText = (details: any) => {
  const topic = REFUSAL_TOPICS[details?.category];
  return `Claude declined to continue with this request${topic ? ` because it touches on ${topic}` : ''}. Try rephrasing it, or choose another model in the model picker.`;
};

// Responses events for one Claude message, in the order Codex reads them.
// Tool calls are handed over once Claude has finished its turn, so a reply
// cut off by its length limit or a refusal never runs a half-written call.
export function responsesTranslator(tools: Map<string, ToolRef>, model: string) {
  let id = 'resp_' + crypto.randomUUID().replace(/-/g, ''), base = id.slice(5);
  const createdAt = Math.floor(Date.now() / 1000);
  const open = new Map<number, any>(), items: { index: number; item: Block }[] = [];
  const held: { index: number; item: Block; events: Block[] }[] = [];
  let next = 0, usage: Record<string, any> = {}, stop: string | null = null, stopDetails: any = null, final = false, status = 'in_progress';
  const output = () => items.slice().sort((a, b) => a.index - b.index).map(entry => entry.item);
  const snapshot = (extra: Block = {}) => ({ id, object: 'response', created_at: createdAt, status, model, output: output(), ...extra });
  const done = (index: number, item: Block, events: Block[]) => { items.push({ index, item }); events.push({ type: 'response.output_item.done', output_index: index, item }); };
  const mergeUsage = (value: any) => { for (const [key, amount] of Object.entries(value || {})) if (amount !== null && amount !== undefined) usage[key] = amount; };

  function startBlock(index: number, block: Block, events: Block[]) {
    const at = next;
    if (block.type === 'text') {
      const itemId = `msg_${base}_${index}`;
      open.set(index, { kind: 'text', at, itemId, text: '' });
      events.push({ type: 'response.output_item.added', output_index: at, item: { type: 'message', id: itemId, status: 'in_progress', role: 'assistant', content: [] } },
        { type: 'response.content_part.added', item_id: itemId, output_index: at, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      if (block.text) delta(index, { type: 'text_delta', text: block.text }, events);
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const itemId = `rs_${base}_${index}`;
      open.set(index, { kind: block.type, at, itemId, text: '', signature: block.signature || '', data: block.data || '', summary: false });
      events.push({ type: 'response.output_item.added', output_index: at, item: { type: 'reasoning', id: itemId, summary: [] } });
      if (block.thinking) delta(index, { type: 'thinking_delta', thinking: block.thinking }, events);
    } else if (block.type === 'tool_use') {
      const ref = tools.get(block.name), itemId = `fc_${callId(block.id)}`, custom = !!ref?.custom;
      const call = { kind: custom ? 'custom' : 'call', at, itemId, callId: block.id, name: ref?.name ?? block.name, namespace: ref?.namespace, json: '' };
      open.set(index, call);
      events.push({ type: 'response.output_item.added', output_index: at, item: custom
        ? { type: 'custom_tool_call', id: itemId, status: 'in_progress', call_id: call.callId, name: call.name, input: '' }
        : { type: 'function_call', id: itemId, status: 'in_progress', call_id: call.callId, name: call.name, ...(call.namespace ? { namespace: call.namespace } : {}), arguments: '' } });
    } else {
      open.set(index, { kind: 'ignored' });
      return;
    }
    next++;
  }
  function delta(index: number, value: Block, events: Block[]) {
    const block = open.get(index);
    if (!block) return;
    if (value.type === 'text_delta' && block.kind === 'text') {
      block.text += value.text;
      events.push({ type: 'response.output_text.delta', item_id: block.itemId, output_index: block.at, content_index: 0, delta: value.text });
    } else if (value.type === 'thinking_delta' && block.kind === 'thinking') {
      if (!block.summary) { block.summary = true; events.push({ type: 'response.reasoning_summary_part.added', item_id: block.itemId, output_index: block.at, summary_index: 0, part: { type: 'summary_text', text: '' } }); }
      block.text += value.thinking;
      events.push({ type: 'response.reasoning_summary_text.delta', item_id: block.itemId, output_index: block.at, summary_index: 0, delta: value.thinking });
    } else if (value.type === 'signature_delta' && block.kind === 'thinking') {
      block.signature = value.signature;
    } else if (value.type === 'input_json_delta' && (block.kind === 'call' || block.kind === 'custom')) {
      block.json += value.partial_json;
      if (block.kind === 'call') events.push({ type: 'response.function_call_arguments.delta', item_id: block.itemId, output_index: block.at, delta: value.partial_json });
    }
  }
  function stopBlock(index: number, events: Block[]) {
    const block = open.get(index);
    open.delete(index);
    if (!block || block.kind === 'ignored') return;
    if (block.kind === 'text') {
      const part = { type: 'output_text', text: block.text, annotations: [] };
      events.push({ type: 'response.output_text.done', item_id: block.itemId, output_index: block.at, content_index: 0, text: block.text },
        { type: 'response.content_part.done', item_id: block.itemId, output_index: block.at, content_index: 0, part });
      done(block.at, { type: 'message', id: block.itemId, status: 'completed', role: 'assistant', content: [part] }, events);
    } else if (block.kind === 'thinking') {
      if (block.summary) events.push({ type: 'response.reasoning_summary_text.done', item_id: block.itemId, output_index: block.at, summary_index: 0, text: block.text },
        { type: 'response.reasoning_summary_part.done', item_id: block.itemId, output_index: block.at, summary_index: 0, part: { type: 'summary_text', text: block.text } });
      done(block.at, { type: 'reasoning', id: block.itemId, summary: block.text ? [{ type: 'summary_text', text: block.text }] : [], encrypted_content: encodeThinking([{ type: 'thinking', thinking: block.text, signature: block.signature }]) }, events);
    } else if (block.kind === 'redacted_thinking') {
      done(block.at, { type: 'reasoning', id: block.itemId, summary: [], encrypted_content: encodeThinking([{ type: 'redacted_thinking', data: block.data }]) }, events);
    } else {
      let input: any;
      try { input = JSON.parse(block.json || '{}'); } catch { return; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return;
      const item: Block = block.kind === 'custom'
        ? { type: 'custom_tool_call', id: block.itemId, status: 'completed', call_id: block.callId, name: block.name, input: typeof input.input === 'string' ? input.input : JSON.stringify(input) }
        : { type: 'function_call', id: block.itemId, status: 'completed', call_id: block.callId, name: block.name, ...(block.namespace ? { namespace: block.namespace } : {}), arguments: block.json || '{}' };
      held.push({ index: block.at, item, events: block.kind === 'call'
        ? [{ type: 'response.function_call_arguments.done', item_id: block.itemId, output_index: block.at, arguments: item.arguments }]
        : [{ type: 'response.custom_tool_call_input.done', item_id: block.itemId, output_index: block.at, input: item.input }] });
    }
  }

  return {
    event(event: any): Block[] {
      const events: Block[] = [];
      if (event?.type === 'message_start') {
        base = String(event.message?.id || base).replace(/[^a-zA-Z0-9_-]/g, '');
        id = 'resp_' + base;
        mergeUsage(event.message?.usage);
        events.push({ type: 'response.created', response: snapshot() });
      } else if (event?.type === 'content_block_start') startBlock(event.index, event.content_block || {}, events);
      else if (event?.type === 'content_block_delta') delta(event.index, event.delta || {}, events);
      else if (event?.type === 'content_block_stop') stopBlock(event.index, events);
      else if (event?.type === 'message_delta') {
        stop = event.delta?.stop_reason ?? stop;
        stopDetails = event.delta?.stop_details ?? stopDetails;
        mergeUsage(event.usage);
        final = true;
      }
      return events;
    },
    end(): Block[] {
      if (!final) return this.fail('The Claude reply ended before it finished. Try again.');
      const events: Block[] = [];
      for (const index of [...open.keys()]) stopBlock(index, events);
      if (['tool_use', 'end_turn', 'stop_sequence', 'pause_turn'].includes(String(stop))) {
        for (const call of held) { events.push(...call.events); done(call.index, call.item, events); }
      }
      if (stop === 'refusal') {
        const itemId = `msg_${base}_refusal`, at = next++;
        const part = { type: 'output_text', text: refusalText(stopDetails), annotations: [] };
        events.push({ type: 'response.output_item.added', output_index: at, item: { type: 'message', id: itemId, status: 'in_progress', role: 'assistant', content: [] } });
        done(at, { type: 'message', id: itemId, status: 'completed', role: 'assistant', content: [part] }, events);
      }
      if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') {
        status = 'incomplete';
        events.push({ type: 'response.incomplete', response: snapshot({ incomplete_details: { reason: 'max_output_tokens' }, usage: responsesUsage(usage) }) });
      } else {
        status = 'completed';
        events.push({ type: 'response.completed', response: snapshot({ usage: responsesUsage(usage) }) });
      }
      return events;
    },
    fail(message: string, code = 'server_error'): Block[] {
      status = 'failed';
      return [{ type: 'response.failed', response: snapshot({ error: { code, message } }) }];
    },
    // Usage is final once the message's closing delta has arrived.
    usage: () => ({ usage, final }),
    response: () => snapshot({ usage: responsesUsage(usage), ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) }),
  };
}

// The SDK loads with the first Claude request, so isolates that only serve
// GPT start without it.
let sdk: Promise<typeof import('npm:@anthropic-ai/sdk@0.128.0')> | null = null;
let client: Anthropic | null = null, clientKey = '';
async function anthropic() {
  const key = claudeKey();
  if (!key) throw fail(503, 'The cloud AI provider is not configured.');
  const { default: Client } = await (sdk ??= import('npm:@anthropic-ai/sdk@0.128.0').catch(error => { sdk = null; throw error; }));
  if (!client || clientKey !== key) { client = new Client({ apiKey: key, maxRetries: 2, timeout: 60_000 }); clientKey = key; }
  return client;
}

// Fast mode that Anthropic turned down, by model: until its retry-after when
// rate limited, or for a while when it isn't offered. Meanwhile requests run
// at the standard speed straight away.
const fastPaused = new Map<string, number>();
function fastPause(error: any, status: number) {
  const headers = error?.headers, value = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  const seconds = Number(value);
  return status === 429 ? (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) : 60) * 1000 : 600_000;
}

// An opaque per-account id, so Anthropic can tell accounts apart without
// learning who they are.
async function accountKey(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('timewarp-claude:' + userId));
  return [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function providerError(status: number, message: string) {
  if (status === 401 || status === 403) return fail(503, 'The cloud AI provider is not configured.');
  if (status === 429) return fail(429, 'Claude is busy right now. Try again in a moment.');
  if (status === 413) return fail(413, 'Request is too large.');
  if (status >= 500) return fail(503, 'Claude is overloaded right now. Try again shortly.');
  const detail = message.replace(/\s+/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, 300);
  return fail(502, `Claude could not start this request (${status}${detail ? ': ' + detail : ''}).`);
}
const withoutThinking = (messages: Message[]) => messages.map(message => message.role === 'assistant' ? { ...message, content: message.content.filter(block => !isThinking(block)) } : message)
  .filter(message => message.content.length);

// Opens Claude's stream with a reservation for its worst-case cost. Fast mode
// falls back to the standard speed when Anthropic can't serve it, at once
// rather than after the SDK's retries, and thinking from another Anthropic
// account (after a key change) is left out.
async function openClaude(admin: any, userId: string, body: any) {
  const named = claudeRoute(body.model);
  if (!named) throw fail(400, 'Unknown Claude model.');
  let route = named.fast && (fastPaused.get(named.model) || 0) > Date.now() ? { ...named, fast: false, billing: named.id } : named;
  const [claude, userKey] = await Promise.all([anthropic(), accountKey(userId)]);
  let { params, tools } = claudeRequest(route, body, userKey);
  for (let attempt = 0; ; attempt++) {
    const reservation = await reserveAgentAi(admin, userId, route.billing, params, { outputTokens: params.max_tokens });
    try {
      const stream = await claude.beta.messages.create({ ...params, stream: true } as any, { signal: AbortSignal.timeout(STREAM_LIMIT_MS), ...(route.fast ? { maxRetries: 0 } : {}) });
      return { stream: stream as unknown as AsyncIterable<any>, reservation, tools };
    } catch (error) {
      // The SDK's API errors carry the HTTP status; a connection that failed
      // or timed out has none, and may have reached the model.
      const status = (error as any)?.status;
      if (typeof status !== 'number') {
        await reservation.finish('uncertain');
        throw fail(504, 'The AI connection timed out. Usage reconciliation is pending.');
      }
      await reservation.finish('released');
      const message = String((error as any)?.error?.error?.message || (error as Error).message || '');
      if (attempt < 2 && route.fast && (status === 429 || /speed|fast/i.test(message))) {
        fastPaused.set(route.model, Date.now() + fastPause(error, status));
        route = { ...route, fast: false, billing: route.id };
        ({ params, tools } = claudeRequest(route, body, userKey));
        continue;
      }
      if (attempt < 2 && status === 400 && /signature|thinking/i.test(message) && params.messages.some((message: Message) => message.content.some(isThinking))) {
        params = { ...params, messages: withoutThinking(params.messages) };
        continue;
      }
      throw providerError(status, message);
    }
  }
}

async function settle(reservation: Awaited<ReturnType<typeof reserveAgentAi>>, translated: ReturnType<typeof responsesTranslator>) {
  const { usage, final } = translated.usage();
  const known = final && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens);
  if (!known) return reservation.finish('uncertain');
  const read = usage.cache_read_input_tokens || 0, written = usage.cache_creation_input_tokens || 0;
  return reservation.finish('settled', usage.input_tokens + read + written, usage.output_tokens, { cached_tokens: read, cache_write_tokens: written, speed: usage.speed });
}
const failure = (error: unknown) => {
  const type = (error as any)?.error?.error?.type || (error as any)?.error?.type;
  return type === 'overloaded_error' ? { code: 'server_is_overloaded', message: 'Claude is overloaded right now. Try again shortly.' }
    : { code: 'server_error', message: 'The Claude reply was interrupted. Try again.' };
};
const sse = (events: Block[]) => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

// Streams Claude's reply as Responses events. Claude's stream is read to the
// end even when the desktop stops listening, so every call is metered.
export async function claudeStream(admin: any, userId: string, body: any, cors: Record<string, string>) {
  const { stream, reservation, tools } = await openClaude(admin, userId, body);
  const translated = responsesTranslator(tools.byClaude, String(body.model));
  const encoder = new TextEncoder();
  let output: ReadableStreamDefaultController<Uint8Array> | null = null, listening = true;
  const client = new ReadableStream<Uint8Array>({ start(controller) { output = controller; }, cancel() { listening = false; } });
  const send = (events: Block[]) => {
    if (!listening || !events.length) return;
    try { output!.enqueue(encoder.encode(sse(events))); } catch { listening = false; }
  };
  const finished = (async () => {
    try {
      for await (const event of stream) send(translated.event(event));
      send(translated.end());
    } catch (error) {
      const { code, message } = failure(error);
      send(translated.fail(message, code));
    } finally {
      if (listening) try { output!.close(); } catch { /* The desktop already left. */ }
    }
    await settle(reservation, translated).catch(() => console.error('[timewarp] Stream settlement requires operator recovery.', { reservationId: reservation.id }));
  })();
  (globalThis as any).EdgeRuntime?.waitUntil(finished);
  return new Response(client, { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

// The same reply as one Responses object, for clients that don't stream.
export async function claudeCall(admin: any, userId: string, body: any) {
  const { stream, reservation, tools } = await openClaude(admin, userId, body);
  const translated = responsesTranslator(tools.byClaude, String(body.model));
  let failed: Block[] = [];
  try {
    for await (const event of stream) translated.event(event);
    failed = translated.end().filter(event => event.type === 'response.failed');
  } catch (error) {
    await settle(reservation, translated).catch(() => {});
    throw fail(502, failure(error).message);
  }
  await settle(reservation, translated);
  if (failed.length) throw fail(502, failed[0].response.error.message);
  const result = translated.response();
  assertCloudSafe(result.output);
  return result;
}
