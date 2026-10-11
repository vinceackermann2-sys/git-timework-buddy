// Claude models on paid plans, by the id the desktop sends (shared/models.cjs).
// Opus 5.5 also runs in Anthropic's Fast mode; the desktop asks for it with a
// "-fast" suffix, because Codex forwards a speed only for its own models.
// Checked against Anthropic's model docs on 2026-10-11.
export const CLAUDE_MODELS: Record<string, { model: string; fast: boolean }> = {
  'anthropic/claude-fable-5-1': { model: 'claude-fable-5-1', fast: false },
  'anthropic/claude-opus-5-5': { model: 'claude-opus-5-5', fast: true },
  'anthropic/claude-sonnet-5-5': { model: 'claude-sonnet-5-5', fast: false },
  'anthropic/claude-haiku-5-5': { model: 'claude-haiku-5-5', fast: false },
};

// The model to call and the name its usage is billed under ("-fast" bills at
// Fast mode's rates, aiCost.ts). Null for a model that isn't Claude.
export function claudeRoute(name: unknown) {
  const value = String(name ?? '');
  const fast = value.endsWith('-fast');
  const id = fast ? value.slice(0, -'-fast'.length) : value;
  const entry = CLAUDE_MODELS[id];
  if (!entry) return null;
  const useFast = fast && entry.fast;
  return { id, model: entry.model, fast: useFast, billing: useFast ? id + '-fast' : id };
}

export const claudeKey = () => (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();

export const PAID_PLANS = new Set(['pro', 'max', 'ultra']);
