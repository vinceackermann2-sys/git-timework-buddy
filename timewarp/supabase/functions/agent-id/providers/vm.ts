// Agent virtual machines: Azure Container Apps sandboxes, hardware-isolated
// Linux microVMs, as the previous Timewarp app used for its cloud agents. A
// machine is resumed for a command and stopped again after it (it also
// suspends itself after a minute idle), so it costs only while it works;
// that time is charged in the owner's credits. Test machines have a state
// but don't run commands.
import { fail } from '../util.ts';
import { MEMORY_GIB_USD_PER_SECOND, VCPU_USD_PER_SECOND } from '../pricing.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';

const SCOPE = 'https://dynamicsessions.io/.default';
const API_VERSION = '2026-02-01-preview';
export const SIZES = {
  small: { cpu: '500m', memory: '1024Mi', cores: 0.5, gib: 1 },
  medium: { cpu: '1000m', memory: '2048Mi', cores: 1, gib: 2 },
} as const;
export type Size = keyof typeof SIZES;

function azure(ctx: Ctx) {
  const get = ctx.config.env;
  if (!ctx.config.providers.vm.configured) throw fail(503, 'provider_unavailable', 'Live machines are not set up on this deployment.');
  const region = (get('AZURE_SANDBOX_REGION') || 'swedencentral').toLowerCase().replace(/[^a-z0-9]/g, '');
  const segment = (value: string) => { if (!value || /[\\/]|\.\.|\0/.test(value)) throw fail(503, 'provider_unavailable', 'The machine provider is misconfigured.'); return encodeURIComponent(value); };
  return {
    tenant: get('AZURE_TENANT_ID'), clientId: get('AZURE_CLIENT_ID'), clientSecret: get('AZURE_CLIENT_SECRET'),
    endpoint: `https://management.${region}.azuredevcompute.io`,
    group: `/subscriptions/${segment(get('AZURE_SUBSCRIPTION_ID'))}/resourceGroups/${segment(get('AZURE_SANDBOX_RESOURCE_GROUP'))}/sandboxGroups/${segment(get('AZURE_SANDBOX_GROUP'))}`,
    diskId: get('AZURE_SANDBOX_DISK_ID'), publicDisk: get('AZURE_SANDBOX_PUBLIC_DISK') || 'ubuntu',
    vcpuRate: Number(get('AZURE_SANDBOX_VCPU_USD_PER_SECOND')) || VCPU_USD_PER_SECOND,
    memoryRate: Number(get('AZURE_SANDBOX_MEMORY_GIB_USD_PER_SECOND')) || MEMORY_GIB_USD_PER_SECOND,
  };
}

let token: { value: string; expires: number; key: string } | null = null;
async function accessToken(ctx: Ctx, config: ReturnType<typeof azure>) {
  const key = `${config.tenant}:${config.clientId}`;
  if (token?.key === key && token.expires > ctx.now() + 60_000) return token.value;
  const response = await ctx.fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret, scope: SCOPE }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || !payload?.access_token) throw fail(503, 'provider_unavailable', 'The machine provider could not be reached.');
  token = { value: String(payload.access_token), expires: ctx.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000, key };
  return token.value;
}

async function request(ctx: Ctx, method: string, path: string, body?: unknown, timeoutMs = 120_000) {
  const config = azure(ctx);
  const response = await ctx.fetch(`${config.endpoint}${config.group}${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`, {
    method, headers: { Authorization: `Bearer ${await accessToken(ctx, config)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
  });
  if (method === 'DELETE' && (response.status === 404 || response.status === 204)) return {};
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }
  if (!response.ok) {
    console.error('[agent-id] azure sandbox', response.status, payload?.error?.code, payload?.error?.message || payload?.message);
    throw fail(502, 'machine_failed', String(payload?.error?.message || payload?.message || 'The machine provider could not complete the request.').slice(0, 300));
  }
  return payload;
}

const sandbox = (id: string) => `/sandboxes/${encodeURIComponent(id)}`;
const STOPPED = new Set(['stopped', 'suspended', 'idle']);

export async function provisionVm(ctx: Ctx, agent: AgentRow, mode: 'live' | 'test', size: Size) {
  if (mode === 'test') return { provider: 'test', providerRef: null as string | null, label: `Test computer (${size})`, status: 'active', state: { size, machine: 'stopped' } };
  const config = azure(ctx), plan = SIZES[size];
  const created = await request(ctx, 'PUT', '/sandboxes', {
    sourcesRef: config.diskId ? { diskImage: { id: config.diskId } } : { diskImage: { name: config.publicDisk, isPublic: true } },
    resources: { cpu: plan.cpu, memory: plan.memory },
    lifecycle: { autoSuspendPolicy: { enabled: true, interval: 60, mode: 'Disk' } },
    labels: { provider: 'timewarp-agent-id', owner: agent.owner_user_id.slice(0, 63), agent: agent.id.slice(0, 63) },
    environment: { TIMEWARP_AGENT_ID: agent.id },
  });
  if (!created?.id) throw fail(502, 'machine_failed', 'The machine provider did not return a machine id.');
  return { provider: 'azure_sandbox', providerRef: String(created.id), label: `Linux computer (${size})`, status: 'provisioning', state: { size, machine: String(created.state || 'creating').toLowerCase() } };
}

export async function machineState(ctx: Ctx, resource: ResourceRow) {
  if (resource.mode === 'test') return String(resource.state.machine || 'stopped');
  const current = await request(ctx, 'GET', sandbox(resource.provider_ref!));
  return String(current?.state || 'unknown').toLowerCase();
}

async function waitFor(ctx: Ctx, resource: ResourceRow, wanted: Set<string>, timeoutMs: number) {
  const started = ctx.now();
  for (;;) {
    const state = await machineState(ctx, resource);
    if (wanted.has(state)) return state;
    if (state === 'failed' || state === 'deleting') throw fail(502, 'machine_failed', `The machine is ${state}.`);
    if (ctx.now() - started > timeoutMs) throw fail(504, 'machine_slow', 'The machine did not get ready in time. Try again in a minute.');
    await ctx.sleep(ctx.now() - started < 2_000 ? 250 : 1_000);
  }
}

export async function startMachine(ctx: Ctx, resource: ResourceRow) {
  const state = await machineState(ctx, resource);
  if (state === 'running') return state;
  if (STOPPED.has(state)) await request(ctx, 'POST', `${sandbox(resource.provider_ref!)}/resume`);
  return waitFor(ctx, resource, new Set(['running']), 120_000);
}
export async function stopMachine(ctx: Ctx, resource: ResourceRow) {
  const state = await machineState(ctx, resource);
  if (STOPPED.has(state)) return state;
  await request(ctx, 'POST', `${sandbox(resource.provider_ref!)}/stop`);
  return waitFor(ctx, resource, STOPPED, 60_000);
}
export async function releaseMachine(ctx: Ctx, resource: ResourceRow) {
  if (resource.mode === 'live' && resource.provider_ref) await request(ctx, 'DELETE', sandbox(resource.provider_ref));
}

// The most a command of this length can cost, and what it did cost.
export function machineCost(ctx: Ctx, size: Size, seconds: number) {
  const config = azure(ctx), plan = SIZES[size] || SIZES.medium;
  return Math.max(1, seconds) * (plan.cores * config.vcpuRate + plan.gib * config.memoryRate);
}

export async function runCommand(ctx: Ctx, resource: ResourceRow, command: string, options: { cwd?: string; timeoutSeconds: number }) {
  const started = ctx.now();
  await startMachine(ctx, resource);
  let result: any, error: unknown = null;
  try {
    result = await request(ctx, 'POST', `${sandbox(resource.provider_ref!)}/executeShellCommand`, { command, ...(options.cwd ? { workingDirectory: options.cwd } : {}) }, options.timeoutSeconds * 1000);
  } catch (caught) { error = caught; }
  finally { await stopMachine(ctx, resource).catch(() => null); }
  const seconds = Math.max(1, Math.ceil((ctx.now() - started) / 1000));
  return {
    exitCode: Number.isFinite(Number(result?.exitCode)) ? Number(result.exitCode) : 1,
    stdout: String(result?.stdout || '').slice(0, 200_000),
    stderr: String(result?.stderr || (error instanceof Error ? error.message : '') || '').slice(0, 50_000),
    seconds, failed: !!error,
  };
}
