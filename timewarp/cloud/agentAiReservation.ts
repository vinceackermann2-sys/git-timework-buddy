import { computeCostUsd } from './aiCost.ts';
import { AI_COST_MARKUP, USD_PER_CREDIT } from './nativeBilling.ts';
export const AGENT_MODEL_OUTPUT_TOKENS = 16_384;

export async function reserveAgentAi(admin: any, userId: string, model: string, body: unknown, bounds?: { inputTokens: number; outputTokens: number }) {
  // UTF-8 bytes are a conservative token ceiling for the byte-based tokenizer;
  // include schema/message framing and the bounded reasoning+output allowance.
  // Non-text requests (audio) pass their own ceilings.
  const inputCeiling = bounds?.inputTokens ?? new TextEncoder().encode(JSON.stringify(body)).length + 4096;
  const credits = computeCostUsd(model, inputCeiling, bounds?.outputTokens ?? AGENT_MODEL_OUTPUT_TOKENS) * AI_COST_MARKUP / USD_PER_CREDIT;
  const id = crypto.randomUUID();
  const { data, error } = await admin.rpc('timewarp_reserve_agent_ai', { p_id: id, p_user_id: userId, p_credits: credits });
  if (error || data !== true) throw Object.assign(new Error(error ? 'AI budget reservation is unavailable. No model request was sent.' : 'Not enough unreserved AI credits for this bounded model call. Other agent work may still be using the shared allowance.'), { status: error ? 503 : 402 });
  let known: { outcome: 'settled' | 'released'; input: number; output: number } | null = null;
  return {
    id,
    async finish(outcome: 'settled' | 'released' | 'uncertain', input = 0, output = 0) {
      if (outcome !== 'uncertain') known = known || { outcome, input, output };
      const desired = known || { outcome, input, output };
      const params = { p_id: id, p_user_id: userId, p_model: model, p_input: desired.input,
        p_output: desired.output, p_cost: computeCostUsd(model, desired.input, desired.output), p_outcome: desired.outcome };
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await admin.rpc('timewarp_energy_complete_ai', params);
        if (!error) return data; // A durable queued settlement may still be pending.
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
      // Usage-only operator evidence survives a database outage in function logs.
      // The deployed log retention/alert destination is a release requirement.
      console.error('[timewarp] AI settlement evidence could not be saved.', { reservationId: id, model,
        outcome: desired.outcome, inputTokens: desired.input, outputTokens: desired.output, costUsd: params.p_cost });
      throw new Error('AI usage reconciliation is pending; its allowance remains reserved.');
    },
  };
}
