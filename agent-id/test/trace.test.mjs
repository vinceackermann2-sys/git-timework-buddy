// Any kind of AI, and tracing what agents make, from the CLI: owners say what
// kind of AI an agent is; agents mark pictures, text and code; anyone checks.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cliEnv, ROOT, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { createProxy, TRACE_FILE_TOOL } from '../cli/src/commands/mcp.js';

const { loadModule } = createRequire(import.meta.url)(path.join(ROOT, '..', 'timewarp', 'scripts', 'agent-id-local.cjs'));

// A picture with a gradient, a circle and some noise.
function picture(width, height, seed = 1) {
  let state = seed;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, circle = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (width / 5) ** 2;
    data[i] = (circle ? 220 : 50 + x / width * 150) + (random() - 0.5) * 16;
    data[i + 1] = (circle ? 180 : 70 + y / height * 110) + (random() - 0.5) * 16;
    data[i + 2] = 140 + Math.sin(x / 7) * 40 + (random() - 0.5) * 16;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

const STORY = 'The bakery opened at six every morning. Lena carried the first trays of bread to the window, set out the cinnamon buns, and wrote the price of the day on the small chalkboard by the door, the way her mother always had.';

describe('any kind of AI and tracing, from the CLI', () => {
  let api, home, env, ownerEnv, owner;
  const cli = (args, extra = {}) => runCli(args, { env: { ...env, ...extra }, cwd: home });
  before(async () => {
    api = await startApi();
    home = tempDir('trace');
    owner = await api.local.user({ email: 'trace-owner@example.test' });
    await api.acceptTerms(owner.session);
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, '.codex'), home });
    ownerEnv = { TIMEWARP_OWNER_KEY: await api.ownerKey(owner) };
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('owners say what kind of AI an agent is, and whose model', async () => {
    const created = await cli(['agents', 'create', 'Painter', '--kind', 'image', '--provider', 'Google', '--model', 'Imagen 4'], ownerEnv);
    assert.equal(created.code, 0, created.stderr);
    const shown = await cli(['agents', 'show', 'Painter'], ownerEnv);
    assert.match(shown.stdout, /Kind:\s+Image model · Google Imagen 4/);
    const changed = await cli(['agents', 'model', 'Painter', '--kind', 'voice', '--model', 'Voice 3'], ownerEnv);
    assert.equal(changed.code, 0, changed.stderr);
    assert.match(changed.stdout, /Painter is now: Voice and audio model · Google Voice 3\./);
    const wrong = await cli(['agents', 'model', 'Painter', '--kind', 'toaster'], ownerEnv);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.stderr, /--kind is one of agent, llm, image, voice, video, code, text, decision, other/);
  });

  it('agents mark pictures, text and code, and anyone can check them', async () => {
    const { encodePng } = loadModule('trace/png.ts');
    const file = path.join(home, 'poster.png');
    const original = await encodePng(picture(240, 180));
    fs.writeFileSync(file, original);
    const marked = await cli(['mark', 'poster.png']);
    assert.equal(marked.code, 0, marked.stderr);
    assert.match(marked.stdout, /^Marked: poster\.png can be traced to Painter \(tr_[0-9a-f]{16}\)\./);
    assert.notDeepEqual(new Uint8Array(fs.readFileSync(file)), original, 'The file now carries the mark.');
    const checked = await cli(['check', 'poster.png']);
    assert.equal(checked.code, 0, checked.stderr);
    assert.match(checked.stdout, /Made by AI: Painter, Voice and audio model \(Google Voice 3\)\./);
    assert.match(checked.stdout, /Answers for it:\s+a person, not verified yet/);

    // Text comes back marked, ready to pipe on; code is left as it is.
    const text = await cli(['mark', '--text', STORY]);
    assert.equal(text.code, 0, text.stderr);
    assert.notEqual(text.stdout.trimEnd(), STORY);
    const story = await cli(['check', '--text', text.stdout.trimEnd()]);
    assert.match(story.stdout, /Found by:\s+its hidden mark/);
    const code = 'export const add = (a, b) => a + b;\nexport const twice = n => add(n, n);\nexport const square = n => n * n;\nexport const cube = n => square(n) * n;\n';
    fs.writeFileSync(path.join(home, 'math.js'), code);
    const coded = await cli(['mark', 'math.js']);
    assert.match(coded.stdout, /Recorded by its fingerprint: math\.js can be traced to Painter/);
    assert.equal(fs.readFileSync(path.join(home, 'math.js'), 'utf8'), code, 'Code is left exactly as it is.');

    // Something no agent made.
    fs.writeFileSync(path.join(home, 'photo.png'), await encodePng(picture(240, 180, 42)));
    const none = await cli(['check', 'photo.png']);
    assert.match(none.stdout, /No Agent ID mark found/);
  });

  it('the MCP server marks a file on this computer itself, when Agent ID offers marking', async () => {
    const written = [], forwarded = [], marks = [];
    const fetchImpl = async (_url, init) => {
      const message = JSON.parse(init.body);
      forwarded.push(message);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'whoami' }, { name: 'trace_mark' }] } }), { headers: { 'content-type': 'application/json' } });
    };
    const marker = { mark: async (file, out) => { marks.push([file, out]); return { data: { marked: 'mark', trace: { id: 'tr_00000000000000aa' } }, out: out || file }; } };
    const proxy = createProxy({ url: 'http://agent-id.test/mcp', auth: async () => ({}), fetchImpl, write: m => written.push(m), log: () => {}, marker });
    await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(written.at(-1).result.tools.find(t => t.name === 'trace_mark_file'), TRACE_FILE_TOOL);
    await proxy.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trace_mark_file', arguments: { path: 'out/poster.png' } } });
    assert.deepEqual(JSON.parse(written.at(-1).result.content[0].text), { marked: 'mark', trace: { id: 'tr_00000000000000aa' }, path: 'out/poster.png' });
    assert.deepEqual(marks, [['out/poster.png', null]]);
    assert.ok(!forwarded.some(m => m.params?.name === 'trace_mark_file'), 'Answered here.');
    await proxy.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'trace_mark_file', arguments: {} } });
    assert.deepEqual([written.at(-1).result.isError, written.at(-1).result.content[0].text], [true, 'path is required: the file to mark.']);
  });
});
