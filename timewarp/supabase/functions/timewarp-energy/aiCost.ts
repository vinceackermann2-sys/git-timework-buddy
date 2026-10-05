// Standard model-token cost basis in USD, checked against published Sol/Luna
// pricing on 2026-10-05. Cached inputs use the standard rate; cache discounts
// are not promised. Long-context premiums apply before the credit markup.

export interface ModelRate {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const MODEL_RATES: Record<string, ModelRate> = {
  'openai/gpt-5.6-sol': { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  'openai/gpt-luna': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  'openai/gpt-5.6-luna': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  // Billed at the audio-input rate for every input token, which is the higher
  // of its audio and text input prices.
  'openai/gpt-4o-mini-transcribe': { inputUsdPerMillion: 3, outputUsdPerMillion: 5 },
  'openai/gpt-5': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  'openai/gpt-5-mini': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
  'openai/gpt-5-nano': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  'google/gemini-3.5-flash': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
  'google/gemini-2.5-flash': { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  'google/gemini-2.5-pro': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
};

export const rateForModel = (gatewayModel: string): ModelRate => {
  const rate=MODEL_RATES[gatewayModel];
  if(!rate)throw Object.assign(Error('This model needs verified pricing before Timewarp credits can fund it.'),{status:503});
  return rate;
};

export const computeCostUsd = (
  gatewayModel: string,
  promptTokens: number,
  responseTokens: number,
): number => {
  const rate = rateForModel(gatewayModel);
  const prompt = Math.max(0, Math.round(promptTokens || 0));
  const response = Math.max(0, Math.round(responseTokens || 0));
  const longContext=/gpt-(?:5\.6-(?:sol|luna)|luna)$/.test(gatewayModel)&&prompt>272000;
  return (prompt / 1_000_000) * rate.inputUsdPerMillion * (longContext?2:1)
    + (response / 1_000_000) * rate.outputUsdPerMillion * (longContext?1.5:1);
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
