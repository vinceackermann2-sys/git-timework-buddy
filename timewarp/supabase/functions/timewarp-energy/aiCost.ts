// Standard model-token cost basis in USD, checked against published Sol/Luna
// pricing checked on 2026-10-07 and GPT-6 pricing on 2026-10-11. Cache writes
// cost 1.25x ordinary input and cache reads a share of it (CACHE_READ). Each
// input token belongs to one category.
// https://developers.openai.com/api/docs/guides/prompt-caching
// https://developers.openai.com/api/docs/pricing
// Long-context premiums apply before the credit markup.

export interface ModelRate {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const MODEL_RATES: Record<string, ModelRate> = {
  'openai/gpt-5.6-sol': { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  'openai/gpt-luna': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  'openai/gpt-5.6-luna': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  // Azure's Global Standard rates equal OpenAI's. Fast (priority processing)
  // costs twice the standard rate.
  'openai/gpt-6-astra': { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
  'openai/gpt-6-astra-fast': { inputUsdPerMillion: 20, outputUsdPerMillion: 100 },
  'openai/gpt-6.1-sol': { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  'openai/gpt-6.1-sol-fast': { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  'openai/gpt-6-luna': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  'openai/gpt-6-luna-fast': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1 },
  // Billed at the audio-input rate for every input token, which is the higher
  // of its audio and text input prices.
  'openai/gpt-4o-mini-transcribe': { inputUsdPerMillion: 3, outputUsdPerMillion: 5 },
  'openai/gpt-5': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  'openai/gpt-5-mini': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
  'openai/gpt-5-nano': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  'google/gemini-3.5-flash': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
  'google/gemini-2.5-flash': { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  'google/gemini-2.5-pro': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  // Anthropic's first-party rates, checked on 2026-10-11. Fast mode on Opus 5.5
  // costs twice the standard rate. Haiku 5.5's rate is for prompts up to 100K
  // tokens; longer prompts cost five times as much (computeCostUsd).
  'anthropic/claude-fable-5-1': { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
  'anthropic/claude-opus-5-5': { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  'anthropic/claude-opus-5-5-fast': { inputUsdPerMillion: 8, outputUsdPerMillion: 40 },
  'anthropic/claude-sonnet-5-5': { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  'anthropic/claude-haiku-5-5': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
};

// Cache reads as a share of the input rate, Fast included, for the models
// whose cache use is priced (Claude's writes are 5-minute ones).
const CACHE_READ: Record<string, number> = {
  'openai/gpt-5.6-sol': 0.1,
  'openai/gpt-luna': 0.1,
  'openai/gpt-5.6-luna': 0.1,
  'openai/gpt-6-astra': 0.1,
  'openai/gpt-6.1-sol': 0.05,
  'openai/gpt-6-luna': 0.1,
  'anthropic/claude-fable-5-1': 0.025,
  'anthropic/claude-opus-5-5': 0.05,
  'anthropic/claude-sonnet-5-5': 0.1,
  'anthropic/claude-haiku-5-5': 0.1,
};
// GPT prompts over 272K tokens cost twice as much input and 1.5x output.
const LONG_CONTEXT = new Set(['openai/gpt-5.6-sol', 'openai/gpt-luna', 'openai/gpt-5.6-luna', 'openai/gpt-6-astra', 'openai/gpt-6.1-sol', 'openai/gpt-6-luna']);

export const rateForModel = (gatewayModel: string): ModelRate => {
  const rate=MODEL_RATES[gatewayModel];
  if(!rate)throw Object.assign(Error('This model needs verified pricing before Timewarp credits can fund it.'),{status:503});
  return rate;
};

// `speed: 'standard'` marks a Fast request that the provider served at the
// standard speed, which costs the standard rate.
export const computeCostUsd = (
  gatewayModel: string,
  promptTokens: number,
  responseTokens: number,
  details?: { cached_tokens?: number; cache_write_tokens?: number; speed?: string },
): number => {
  const model = details?.speed === 'standard' && gatewayModel.endsWith('-fast') ? gatewayModel.slice(0, -'-fast'.length) : gatewayModel;
  const rate = rateForModel(model), base = model.replace(/-fast$/, '');
  const prompt = Math.max(0, Math.round(promptTokens || 0));
  const response = Math.max(0, Math.round(responseTokens || 0));
  const gptContext=LONG_CONTEXT.has(base)&&prompt>272000;
  const haikuContext=base==='anthropic/claude-haiku-5-5'&&prompt>100000;
  const cached = details?.cached_tokens ?? 0, written = details?.cache_write_tokens ?? 0;
  if (![cached, written].every(value => Number.isSafeInteger(value) && value >= 0) || cached + written > prompt) {
    throw new Error('Invalid provider cache-token accounting. Usage needs reconciliation.');
  }
  const cacheRead = CACHE_READ[base];
  const weighted = cacheRead !== undefined ? prompt - cached - written + cached * cacheRead + written * 1.25 : prompt;
  return (weighted / 1_000_000) * rate.inputUsdPerMillion * (gptContext?2:haikuContext?5:1)
    + (response / 1_000_000) * rate.outputUsdPerMillion * (gptContext?1.5:haikuContext?5:1);
};

// Image generation is billed per image, not per token. Override with the
// AI_IMAGE_COST_USD secret if the gateway's gpt-image-2 rate changes.
export const imageCostUsd = (): number => {
  const parsed = Number(Deno.env.get('AI_IMAGE_COST_USD'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.04;
};

// Rough token counts for paths where the provider reports none (transcription,
// and streaming through the Lovable fallback). ~4 characters per token is the
// usual English approximation; these exist so such calls are not billed as free,
// not to be exact.
export const tokensFromCharCount = (chars: number): number =>
  Math.ceil(Math.max(0, chars || 0) / 4);

export const estimateTokens = (text: string): number =>
  tokensFromCharCount(String(text || '').length);
