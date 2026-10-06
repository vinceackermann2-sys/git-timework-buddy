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
