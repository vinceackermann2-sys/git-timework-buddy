export const azureFoundryBase = () => (Deno.env.get('GPT_AZURE_ENDPOINT')
  || 'https://vinceackermann11-4594-resource.services.ai.azure.com/openai/v1').replace(/\/+$/, '');

export const azureSolModel = () => Deno.env.get('GPT_SOL_MODEL') || 'gpt-5.6-sol';
export const azureLunaModel = () => Deno.env.get('GPT_LUNA_MODEL') || 'gpt-5.6-luna';
export const azureImageModel = () => Deno.env.get('GPT_IMAGE_MODEL') || 'gpt-image-2';
export const azureRealtimeModel = () => Deno.env.get('GPT_REALTIME_MODEL') || 'gpt-realtime-2.1-mini';
export const azureTranscribeModel = () => Deno.env.get('GPT_REALTIME_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe';

const splitKeys = (value: string) => [...new Set(value.split(/[\s,]+/).filter(Boolean))];

// Azure resource keys are not deployment-specific. Prefer the new Sol secret
// name while accepting the retained Terra secret as a compatibility alias, so
// production can move models without copying or exposing the resource key.
export const azureSolKeys = () => splitKeys(
  Deno.env.get('GPT_SOL_KEY') || Deno.env.get('GPT_TERRA_KEY') || '',
);
export const azureTranscribeKeys = () => splitKeys(Deno.env.get('GPT_REALTIME_KEY') || '');
export const azureLunaKeys = () => splitKeys(
  Deno.env.get('GPT_LUNA_KEY') || Deno.env.get('GPT_SOL_KEY') || Deno.env.get('GPT_TERRA_KEY') || '',
);

// Timewarp's GPT models by the name the desktop sends, with their Azure
// deployments (a secret can rename one). The GPT-6 models are part of the paid
// plans and offer Fast (Azure priority processing); GPT-5.6 serves Free.
const AZURE_MODELS: Record<string, { deployment: () => string; keys: () => string[]; paid: boolean; fast: boolean }> = {
  'gpt-5.6-sol': { deployment: azureSolModel, keys: azureSolKeys, paid: false, fast: false },
  'gpt-5.6-luna': { deployment: azureLunaModel, keys: azureLunaKeys, paid: false, fast: false },
  'gpt-6-astra': { deployment: () => Deno.env.get('GPT_ASTRA_MODEL') || 'gpt-6-astra', keys: azureSolKeys, paid: true, fast: true },
  'gpt-6.1-sol': { deployment: () => Deno.env.get('GPT_SOL_6_1_MODEL') || 'gpt-6.1-sol', keys: azureSolKeys, paid: true, fast: true },
  'gpt-6-luna': { deployment: () => Deno.env.get('GPT_LUNA_6_MODEL') || 'gpt-6-luna', keys: azureLunaKeys, paid: true, fast: true },
};

// The deployment to call and the name usage is billed under ("-fast" bills at
// Fast rates, aiCost.ts). Older clients' names, and any other, keep Sol 5.6.
// Codex's approval reviews ("codex-auto-review") answer with a short verdict,
// so they run on Luna 5.6, billed as Luna, with a small output cap (index.ts).
export function azureRoute(name: unknown, serviceTier?: unknown) {
  const value = String(name ?? '').replace(/^openai\//, ''), review = value === 'codex-auto-review';
  const slug = AZURE_MODELS[value] ? value : review || value === 'gpt-luna' || value === azureLunaModel() ? 'gpt-5.6-luna' : 'gpt-5.6-sol';
  const entry = AZURE_MODELS[slug], fast = entry.fast && (serviceTier === 'priority' || serviceTier === 'fast');
  return { slug, deployment: entry.deployment(), keys: entry.keys(), paid: entry.paid, fast, billing: `openai/${slug}${fast ? '-fast' : ''}`, ...(review ? { review } : {}) };
}
export type AzureRoute = ReturnType<typeof azureRoute>;

// One prompt cache key per account and model, so a new chat reads the tools
// and instructions that the account's earlier chats cached. Codex's own key is
// per thread, which left every chat's first request uncached.
export async function promptCacheKey(userId: string, model: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`timewarp-cache:${userId}:${model}`));
  return 'tw-' + [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// 24-hour prompt cache retention when the GPT_PROMPT_CACHE_RETENTION secret is
// "24h". Off by default until the deployments are known to take it; one that
// answers 400 to it is asked again without it (nativeResponses.ts).
export const azureCacheRetention = () => Deno.env.get('GPT_PROMPT_CACHE_RETENTION') === '24h';
// Azure reports the tier that served a request; with no report, the requested one.
export const servedSpeed = (route: AzureRoute, tier: unknown) => !route.fast || (typeof tier === 'string' && !/^(priority|fast)$/.test(tier)) ? 'standard' : 'fast';

// Safe to return to authenticated clients: this reports only route/model
// readiness and never includes key material, endpoints, or secret digests.
export const azureAgentAiReadiness = () => {
  const sol = azureSolKeys().length > 0;
  const luna = azureLunaKeys().length > 0;
  const image = Boolean(Deno.env.get('GPT_IMAGE_KEY'));
  const realtime = Boolean(Deno.env.get('GPT_REALTIME_KEY'));
  const capabilities = {
    sol: { available: sol, model: azureSolModel() },
    luna: { available: luna, model: azureLunaModel() },
    image: { available: image, model: azureImageModel() },
    realtime: { available: realtime, model: azureRealtimeModel() },
    transcription: { available: realtime, model: azureTranscribeModel() },
  };
  return {
    ready: Object.values(capabilities).every((capability) => capability.available),
    capabilities,
  };
};
