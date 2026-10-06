import { reserveAgentAi } from './agentAiReservation.ts';
import { estimateTokens } from './aiCost.ts';
import { azureFoundryBase, azureTranscribeKeys, azureTranscribeModel } from './azureAgentAi.ts';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_TYPES = /^audio\/(?:webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a)(?:;.*)?$/i;

// Error bodies follow the provider shape the desktop dictation client reads:
// `usage_limit_reached` opens the credits prompt instead of a generic failure.
const fail = (status: number, message: string, type = 'invalid_request_error') =>
  Object.assign(new Error(message), { status, type });

// Audio has no text to measure before upload. MediaRecorder Opus runs at about
// 32 kbit/s (~1000 audio tokens a minute); bounding at one token per 100 bytes
// stays above the provider's count down to ~13 kbit/s.
const audioTokenCeiling = (bytes: number) => Math.max(2000, Math.ceil(bytes / 100));
const audioTokenEstimate = (bytes: number) => Math.ceil(bytes / 240);

export async function transcribe(admin: any, userId: string, req: Request) {
  const keys = azureTranscribeKeys();
  if (!keys.length) throw fail(503, 'Voice transcription is not configured.', 'server_error');
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) throw fail(413, 'Recording is too long. Keep voice input under about 15 minutes.');
  let form: FormData;
  try { form = await req.formData(); } catch { throw fail(400, 'Send the recording as multipart form data.'); }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw fail(400, 'Audio bytes are required.');
  if (file.size > MAX_AUDIO_BYTES) throw fail(413, 'Recording is too long. Keep voice input under about 15 minutes.');
  if (!AUDIO_TYPES.test(file.type || 'audio/webm')) throw fail(415, 'Unsupported recording format.');

  const model = azureTranscribeModel();
  const inputCeiling = audioTokenCeiling(file.size), outputCeiling = 2000 + Math.ceil(inputCeiling / 4);
  let reservation: Awaited<ReturnType<typeof reserveAgentAi>>;
  try {
    reservation = await reserveAgentAi(admin, userId, `openai/${model}`, null, { inputTokens: inputCeiling, outputTokens: outputCeiling });
  } catch (error) {
    if ((error as any)?.status === 402) throw fail(402, 'Voice input requires available credits.', 'usage_limit_reached');
    throw error;
  }

  const upload = new FormData();
  upload.append('file', file, file.name || 'dictation.webm');
  upload.append('model', model);
  upload.append('response_format', 'json');
  let upstream: Response;
  try {
    upstream = await fetch(`${azureFoundryBase()}/audio/transcriptions`, {
      method: 'POST', headers: { 'api-key': keys[0] }, body: upload,
      signal: AbortSignal.timeout(90_000), redirect: 'error',
    });
  } catch {
    await reservation.finish('uncertain');
    throw fail(504, 'Transcription timed out. Try again.', 'server_error');
  }
  const output = await upstream.json().catch(() => null);
  if (!upstream.ok || typeof output?.text !== 'string') {
    await reservation.finish(output ? 'released' : 'uncertain');
    throw fail(upstream.status === 429 ? 429 : 502, `The transcription provider could not complete this request (${upstream.status}).`, 'server_error');
  }
  // gpt-4o transcription models report token usage; estimate only when absent.
  const usage = output.usage, reported = Number.isFinite(usage?.input_tokens) && Number.isFinite(usage?.output_tokens);
  const input = Math.min(inputCeiling, reported ? usage.input_tokens : audioTokenEstimate(file.size));
  const outputTokens = Math.min(outputCeiling, reported ? usage.output_tokens : estimateTokens(output.text));
  await reservation.finish('settled', input, outputTokens);
  return { text: output.text.trim() };
}
