import * as React from 'npm:react@18.3.1';
import { renderAsync } from 'npm:@react-email/components@0.0.22';
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { resolveUser } from '../_shared/auth.ts';
import { consumeRateLimit, envLimit, rateLimitResponse } from '../_shared/rateLimit.ts';
import { WorkspaceInviteEmail } from '../_shared/email-templates/workspace-invite.tsx';
import { dispatchEmailQueue } from '../_shared/emailQueue.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const cleanText = (value: unknown, fallback = '') =>
  String(value ?? fallback).replace(/\s+/g, ' ').trim();

const normalizeEmail = (value: unknown) => cleanText(value).toLowerCase();

const normalizeRole = (value: unknown): 'owner' | 'admin' | 'lead' => {
  const role = cleanText(value).toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'lead' ? role : 'lead';
};

const isManagerRole = (role?: string | null) => role === 'owner' || role === 'admin';

const TEAM_WORKSPACE_LIMIT = 3;
const WORKSPACE_LIMIT_MESSAGE = 'You can have one personal workspace and up to 3 team workspaces.';
const WORKSPACE_INVITE_DAYS = 14;
const TIMEWARP_SITE_URL = (Deno.env.get('TIMEWARP_SITE_URL') || Deno.env.get('SITE_URL') || 'https://timewarpdev.com').replace(/\/+$/, '');
const TIMEWARP_EMAIL_FROM = Deno.env.get('TIMEWARP_EMAIL_FROM') || 'Timewarp <noreply@agents.timewarpdev.com>';

const WORKSPACE_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  lead: 'Team lead',
} as const;

const isWorkspaceLimitError = (error: unknown) => {
  const value = asRecord(error);
  return [value.message, value.details, value.hint]
    .some(part => String(part || '').includes('TIMEWARP_TEAM_WORKSPACE_LIMIT_REACHED'));
};

const isUuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

const COMPANY_BASE_BUCKET = 'timewarp-company-base';
const COMPANY_BASE_MAX_FILES = 20_000;
const COMPANY_BASE_MAX_MANIFEST_BYTES = 5_000_000;
const COMPANY_BASE_URL_BATCH = 100;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const normalizeCompanyBaseHashList = (value: unknown) => [...new Set(asArray(value)
  .map(item => cleanText(item).toLowerCase())
  .filter(hash => SHA256_PATTERN.test(hash)))]
  .slice(0, COMPANY_BASE_URL_BATCH);

const normalizeCompanyBaseManifest = (value: unknown) => {
  const source = asRecord(value);
  const rawFiles = asArray(source.files);
  if (rawFiles.length > COMPANY_BASE_MAX_FILES) throw new Error('Company Base contains too many files to sync.');
  const files = rawFiles.map(item => {
    const entry = asRecord(item);
    const filePath = String(entry.path || '').replace(/\\/g, '/').trim();
    const hash = cleanText(entry.hash).toLowerCase();
    const size = Math.max(0, Math.floor(Number(entry.size) || 0));
    if (!filePath || filePath.startsWith('/') || /^[a-z]:\//i.test(filePath) || filePath.includes('\0') || filePath.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Company Base manifest contains an invalid path.');
    }
    if (filePath.length > 1_000 || !SHA256_PATTERN.test(hash)) throw new Error('Company Base manifest contains an invalid file.');
    return { path: filePath, hash, size };
  });
  const manifest = { schema: 1, files };
  if (JSON.stringify(manifest).length > COMPANY_BASE_MAX_MANIFEST_BYTES) throw new Error('Company Base manifest is too large to sync.');
  return manifest;
};

const companyBaseObjectPath = (workspaceId: string, hash: string) =>
  `workspaces/${workspaceId}/objects/${hash}`;

const AGENT_TEMPLATE_SECRET_KEYS = new Set([
  'access_token', 'accesstoken', 'api_key', 'apikey', 'authorization', 'cookie',
  'cookies', 'headers', 'password', 'refresh_token', 'refreshtoken', 'secret',
  'token', 'webhooktoken', 'webhookurl', 'credentialid', 'privateconnectorid',
  'path', 'command', 'args',
]);

const sanitizeAgentTemplateValue = (value: unknown, key = ''): any => {
  if (AGENT_TEMPLATE_SECRET_KEYS.has(key.toLowerCase())) return undefined;
  if (Array.isArray(value)) return value.map(item => sanitizeAgentTemplateValue(item)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 120_000) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([entryKey, entryValue]) => {
    const sanitized = sanitizeAgentTemplateValue(entryValue, entryKey);
    return sanitized === undefined ? [] : [[entryKey, sanitized]];
  }));
};

const sanitizeAgentTemplate = (value: unknown) => {
  const source = asRecord(sanitizeAgentTemplateValue(value));
  const sourceAgentId = cleanText(source.sourceAgentId || source.id).slice(0, 160);
  const safeTrigger = asRecord(source.trigger).kind === 'webhook' || asRecord(source.trigger).kind === 'agent'
    ? { kind: 'manual' }
    : asRecord(source.trigger);
  const safeFlow = asRecord(source.flow);
  const safeFlowNodes = asArray(safeFlow.nodes).map(node => {
    const record = asRecord(node);
    return record.kind === 'trigger' ? { ...record, trigger: safeTrigger } : record;
  });
  const template = {
    ...source,
    templateVersion: 1,
    sourceAgentId,
    status: 'paused',
    autopilot: false,
    autonomy: 'draft_first',
    executionTarget: 'cloud',
    trigger: safeTrigger,
    flow: { ...safeFlow, nodes: safeFlowNodes },
    connections: [],
    contextSources: asArray(source.contextSources)
      .filter(item => asRecord(item).kind === 'image')
      .map(item => ({ id: cleanText(asRecord(item).id), kind: 'image', name: cleanText(asRecord(item).name, 'Image creation') })),
    runs: [],
  };
  delete (template as any).id;
  delete (template as any).cloudConsentAt;
  delete (template as any).verificationReport;
  delete (template as any).createdAt;
  return template;
};

const sanitizeSharedChat = (value: unknown) => {
  const source = asRecord(value);
  return {
    title: cleanText(source.title, 'Shared chat').slice(0, 200),
    messages: asArray(source.messages),
    artifacts: asArray(source.artifacts),
    contextUsage: source.contextUsage || null,
    tokensUsed: Number.isFinite(source.tokensUsed) ? Math.max(0, Math.floor(source.tokensUsed)) : null,
    contextAttachments: asArray(source.contextAttachments),
  };
};

const hashInviteToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

let cachedAdminClient: any = null;
let cachedAdminClientKey = '';

const getAdminClient = (supabaseUrl: string, serviceRoleKey: string) => {
  const cacheKey = `${supabaseUrl}:${serviceRoleKey}`;
  if (!cachedAdminClient || cachedAdminClientKey !== cacheKey) {
    cachedAdminClient = createClient(supabaseUrl, serviceRoleKey);
    cachedAdminClientKey = cacheKey;
  }
  return cachedAdminClient;
};

const getAuthUser = (supabaseUrl: string, serviceRoleKey: string, authHeader: string) =>
  resolveUser(authHeader, createClient(supabaseUrl, serviceRoleKey));

const loadMembership = async (admin: any, userId: string, workspaceId: string) => {
  const { data, error } = await admin
    .from('timewarp_workspace_members')
    .select('id, workspace_id, user_id, email, name, role, status, share_connector_data_with_memory, share_chat_memory_episodes, joined_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const requireWorkspaceManager = async (admin: any, userId: string, workspaceId: string) => {
  const member = await loadMembership(admin, userId, workspaceId);
  if (!member) return { ok: false as const, status: 403, error: 'Workspace membership required.' };
  if (!isManagerRole(member.role)) return { ok: false as const, status: 403, error: 'Owner or admin access required.' };
  return { ok: true as const, member };
};

const loadWorkspaceDetails = async (admin: any, userId: string, workspaceId: string) => {
  const member = await loadMembership(admin, userId, workspaceId);
  if (!member) return null;

  const { data: workspace, error: workspaceError } = await admin
    .from('timewarp_workspaces')
    .select('id, name, created_by, settings, created_at, updated_at')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) return null;

  const { data: members, error: membersError } = await admin
    .from('timewarp_workspace_members')
    .select('id, workspace_id, user_id, email, name, role, status, share_connector_data_with_memory, share_chat_memory_episodes, joined_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (membersError) throw membersError;

  const { data: invites, error: invitesError } = await admin
    .from('timewarp_workspace_invites')
    .select('id, workspace_id, email, role, invited_by, invited_by_email, status, email_sent, email_error, email_message_id, last_email_sent_at, expires_at, accepted_by, accepted_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (invitesError) throw invitesError;

  return {
    workspace,
    currentMember: member,
    members: asArray(members),
    invites: asArray(invites),
  };
};

// Owner-affecting member changes go through a Postgres function that locks the
// workspace's owner rows, so two simultaneous demote/remove/leave calls can't
// both pass the "last owner" check. Returns 'fallback' when the migration that
// creates the function hasn't been applied yet.
const guardedMemberUpdate = async (
  admin: any,
  workspaceId: string,
  memberId: string,
  action: 'remove' | 'set_role',
  newRole?: string,
): Promise<'ok' | 'last_owner' | 'not_found' | 'invalid' | 'fallback'> => {
  const { data, error } = await admin.rpc('timewarp_update_member_guarded', {
    p_workspace_id: workspaceId,
    p_member_id: memberId,
    p_action: action,
    p_new_role: newRole ?? null,
  });
  if (error) {
    const missingFunction = String(error.code || '') === 'PGRST202'
      || /timewarp_update_member_guarded/i.test(String(error.message || ''));
    if (missingFunction) {
      console.warn('[timewarp-workspaces] timewarp_update_member_guarded missing; using non-atomic fallback. Apply the multiuser hardening migration.');
      return 'fallback';
    }
    throw error;
  }
  const result = cleanText(data);
  return (['ok', 'last_owner', 'not_found', 'invalid'].includes(result) ? result : 'invalid') as
    'ok' | 'last_owner' | 'not_found' | 'invalid';
};

const countActiveOwners = async (admin: any, workspaceId: string) => {
  const { count, error } = await admin
    .from('timewarp_workspace_members')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (error) throw error;
  return count || 0;
};

const inviteExpiry = () => new Date(Date.now() + WORKSPACE_INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();

const maskEmail = (email: string) => {
  const [local = '', domain = ''] = normalizeEmail(email).split('@');
  if (!local || !domain) return 'the invited email address';
  return `${local.slice(0, 2)}${local.length > 2 ? '•••' : ''}@${domain}`;
};

const enqueueWorkspaceInviteEmail = async (admin: any, options: {
  inviteId: string;
  token: string;
  recipientEmail: string;
  workspaceName: string;
  inviterName: string;
  inviterEmail: string;
  role: 'owner' | 'admin' | 'lead';
}) => {
  const messageId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const inviteUrl = `${TIMEWARP_SITE_URL}/workspace-invite?token=${encodeURIComponent(options.token)}`;
  const templateProps = {
    siteUrl: TIMEWARP_SITE_URL,
    inviteUrl,
    workspaceName: options.workspaceName,
    inviterName: options.inviterName,
    inviterEmail: options.inviterEmail,
    roleLabel: WORKSPACE_ROLE_LABELS[options.role],
  };
  const html = await renderAsync(React.createElement(WorkspaceInviteEmail, templateProps));
  const text = await renderAsync(React.createElement(WorkspaceInviteEmail, templateProps), { plainText: true });

  const { error: logError } = await admin.from('email_send_log').insert({
    message_id: messageId,
    template_name: 'workspace_invite',
    recipient_email: options.recipientEmail,
    status: 'pending',
  });
  if (logError) throw logError;

  const { error: enqueueError } = await admin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      run_id: runId,
      message_id: messageId,
      idempotency_key: `workspace-invite/${options.inviteId}/${messageId}`,
      to: options.recipientEmail,
      from: TIMEWARP_EMAIL_FROM,
      subject: `${options.inviterName} invited you to ${options.workspaceName} on Timewarp`,
      html,
      text,
      purpose: 'transactional',
      label: 'workspace_invite',
      queued_at: new Date().toISOString(),
    },
  });

  if (enqueueError) {
    await admin.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'workspace_invite',
      recipient_email: options.recipientEmail,
      status: 'failed',
      error_message: 'Failed to enqueue workspace invitation',
    });
    throw enqueueError;
  }

  try {
    await dispatchEmailQueue();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'workspace_invite',
      recipient_email: options.recipientEmail,
      status: 'failed',
      error_message: `Queue dispatch failed: ${message}`.slice(0, 1000),
    });
    throw new Error(`Workspace invitation email could not start delivery: ${message}`, { cause: error });
  }

  return { messageId, inviteUrl };
};

const countActiveTeamWorkspaces = async (admin: any, userId: string) => {
  const { count, error } = await admin
    .from('timewarp_workspace_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw error;
  return count || 0;
};

const acceptInviteRow = async (admin: any, invite: any, user: any) => {
  const email = normalizeEmail(user.email || invite.email);
  const name = cleanText(user.user_metadata?.name || user.user_metadata?.full_name || email.split('@')[0], 'Member');
  const role = normalizeRole(invite.role);
  const now = new Date().toISOString();

  const { error: memberError } = await admin
    .from('timewarp_workspace_members')
    .upsert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      email,
      name,
      role,
      status: 'active',
      joined_at: now,
    }, { onConflict: 'workspace_id,user_id' });
  if (memberError) throw memberError;

  const { error: inviteError } = await admin
    .from('timewarp_workspace_invites')
    .update({
      status: 'accepted',
      accepted_by: user.id,
      accepted_at: now,
    })
    .eq('id', invite.id);
  if (inviteError) throw inviteError;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase service configuration is missing.' }, 500);
  }

  const admin = getAdminClient(supabaseUrl, serviceRoleKey);
  const body = asRecord(await req.json().catch(() => ({})));
  const action = cleanText(body.action);

  try {
    // The opaque token is the only public capability. This endpoint returns
    // just enough information to render the invitation page before sign-in;
    // accepting still requires an authenticated user with the invited email.
    if (action === 'getInvite') {
      const token = cleanText(body.token);
      if (!token) return jsonResponse({ error: 'Invite token is required.' }, 400);
      const tokenHash = await hashInviteToken(token);
      const { data: invite, error } = await admin
        .from('timewarp_workspace_invites')
        .select('id, workspace_id, email, role, invited_by_email, status, expires_at')
        .eq('token_hash', tokenHash)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      if (!invite) return jsonResponse({ error: 'Invite not found or expired.' }, 404);

      const { data: workspace, error: workspaceError } = await admin
        .from('timewarp_workspaces')
        .select('name')
        .eq('id', invite.workspace_id)
        .maybeSingle();
      if (workspaceError) throw workspaceError;
      if (!workspace) return jsonResponse({ error: 'Workspace not found.' }, 404);

      return jsonResponse({
        invite: {
          workspaceName: cleanText(workspace.name, 'Timewarp workspace'),
          role: normalizeRole(invite.role),
          emailHint: maskEmail(invite.email),
          invitedByEmail: normalizeEmail(invite.invited_by_email),
          expiresAt: invite.expires_at,
        },
      });
    }

    const authHeader = req.headers.get('Authorization') || '';
    const user = await getAuthUser(supabaseUrl, serviceRoleKey, authHeader);
    if (!user) {
      return jsonResponse({ error: 'Not authenticated' }, 401);
    }

    if (action === 'getCompanyBaseManifest') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);

      const { data, error } = await admin
        .from('timewarp_workspace_company_bases')
        .select('revision, manifest, updated_by, updated_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (error) throw error;
      return jsonResponse({
        workspaceId,
        revision: Number(data?.revision) || 0,
        manifest: data?.manifest ? normalizeCompanyBaseManifest(data.manifest) : null,
        updatedBy: data?.updated_by || null,
        updatedAt: data?.updated_at || null,
      });
    }

    if (action === 'signCompanyBaseDownloads') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      const hashes = normalizeCompanyBaseHashList(body.hashes);
      if (!hashes.length) return jsonResponse({ downloads: {} });

      const paths = hashes.map(hash => companyBaseObjectPath(workspaceId, hash));
      const { data, error } = await admin.storage.from(COMPANY_BASE_BUCKET).createSignedUrls(paths, 15 * 60);
      if (error) throw error;
      const downloads = Object.fromEntries(asArray(data).flatMap((entry, index) => {
        const signedUrl = cleanText(entry?.signedUrl || entry?.signedURL);
        return signedUrl ? [[hashes[index], signedUrl]] : [];
      }));
      return jsonResponse({ downloads });
    }

    if (action === 'prepareCompanyBaseUploads') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      const hashes = normalizeCompanyBaseHashList(body.hashes);
      const prepared = await Promise.all(hashes.map(async hash => {
        const objectPath = companyBaseObjectPath(workspaceId, hash);
        const { data, error } = await admin.storage.from(COMPANY_BASE_BUCKET)
          .createSignedUploadUrl(objectPath, { upsert: true });
        if (error) throw error;
        return [hash, { path: objectPath, signedUrl: data.signedUrl, token: data.token }] as const;
      }));
      const uploads = Object.fromEntries(prepared);
      return jsonResponse({ uploads });
    }

    if (action === 'commitCompanyBaseManifest') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      const manifest = normalizeCompanyBaseManifest(body.manifest);
      const baseRevision = Math.max(0, Math.floor(Number(body.baseRevision) || 0));
      const now = new Date().toISOString();

      if (baseRevision === 0) {
        const { data, error } = await admin
          .from('timewarp_workspace_company_bases')
          .insert({ workspace_id: workspaceId, revision: 1, manifest, updated_by: user.id, updated_at: now })
          .select('revision, updated_at')
          .maybeSingle();
        if (!error && data) return jsonResponse({ ok: true, revision: Number(data.revision), updatedAt: data.updated_at });
        if (error && String(error.code || '') !== '23505') throw error;
      }

      const { data, error } = await admin
        .from('timewarp_workspace_company_bases')
        .update({ revision: baseRevision + 1, manifest, updated_by: user.id, updated_at: now })
        .eq('workspace_id', workspaceId)
        .eq('revision', baseRevision)
        .select('revision, updated_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: 'Company Base changed in the cloud. Sync and retry your change.', code: 'revision_conflict' }, 409);
      return jsonResponse({ ok: true, revision: Number(data.revision), updatedAt: data.updated_at });
    }

    if (action === 'list') {
      const { data: memberships, error: membershipError } = await admin
        .from('timewarp_workspace_members')
        .select('id, workspace_id, user_id, email, name, role, status, share_connector_data_with_memory, share_chat_memory_episodes, joined_at, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });
      if (membershipError) throw membershipError;

      const workspaceIds = asArray(memberships).map(member => member.workspace_id).filter(Boolean);
      let workspaces: any[] = [];
      if (workspaceIds.length > 0) {
        const { data, error } = await admin
          .from('timewarp_workspaces')
          .select('id, name, created_by, settings, created_at, updated_at')
          .in('id', workspaceIds);
        if (error) throw error;
        const workspaceById = new Map(asArray(data).map(workspace => [workspace.id, workspace]));
        workspaces = asArray(memberships)
          .map(member => ({
            ...workspaceById.get(member.workspace_id),
            membership: member,
          }))
          .filter(workspace => workspace.id);
      }

      const userEmail = normalizeEmail(user.email);
      const { data: pendingInvites, error: pendingError } = await admin
        .from('timewarp_workspace_invites')
        .select('id, workspace_id, email, role, status, email_sent, email_error, email_message_id, last_email_sent_at, expires_at, created_at')
        .eq('status', 'pending')
        .eq('email', userEmail)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (pendingError) throw pendingError;

      return jsonResponse({ workspaces, pendingInvites: asArray(pendingInvites) });
    }

    if (action === 'create') {
      const name = cleanText(body.name, 'New workspace').slice(0, 120);
      if (!name) return jsonResponse({ error: 'Workspace name is required.' }, 400);

      const email = normalizeEmail(user.email);
      const ownerName = cleanText(user.user_metadata?.name || user.user_metadata?.full_name || email.split('@')[0], 'Owner');
      const { data, error } = await admin.rpc('timewarp_create_workspace_guarded', {
        p_user_id: user.id,
        p_name: name,
        p_email: email,
        p_owner_name: ownerName,
      });
      if (error) throw error;

      return jsonResponse(data);
    }

    if (action === 'get') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const details = await loadWorkspaceDetails(admin, user.id, workspaceId);
      if (!details) return jsonResponse({ error: 'Workspace not found.' }, 404);
      return jsonResponse(details);
    }

    if (action === 'shareAgent') {
      const workspaceId = cleanText(body.workspaceId);
      const recipientUserId = cleanText(body.recipientUserId);
      if (!isUuid(workspaceId) || !isUuid(recipientUserId)) {
        return jsonResponse({ error: 'Valid workspaceId and recipientUserId are required.' }, 400);
      }
      const sender = await loadMembership(admin, user.id, workspaceId);
      if (!sender) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      if (recipientUserId === user.id) return jsonResponse({ error: 'Choose another workspace member.' }, 400);
      const recipient = await loadMembership(admin, recipientUserId, workspaceId);
      if (!recipient) return jsonResponse({ error: 'That person is not an active workspace member.' }, 404);

      const template = sanitizeAgentTemplate(body.template);
      const sourceAgentId = cleanText(template.sourceAgentId);
      const agentName = cleanText((template as any).name, 'Shared agent').slice(0, 120);
      const sourceAgentVersion = Math.max(1, Math.floor(Number((template as any).version) || 1));
      if (!sourceAgentId) return jsonResponse({ error: 'The agent template is missing its source id.' }, 400);
      if (JSON.stringify(template).length > 250_000) return jsonResponse({ error: 'That agent template is too large to share.' }, 413);

      const { data: share, error } = await admin
        .from('timewarp_agent_shares')
        .upsert({
          workspace_id: workspaceId,
          sender_user_id: user.id,
          recipient_user_id: recipientUserId,
          source_agent_id: sourceAgentId,
          source_agent_version: sourceAgentVersion,
          agent_name: agentName,
          template,
          status: 'pending',
          accepted_at: null,
        }, { onConflict: 'workspace_id,sender_user_id,recipient_user_id,source_agent_id,source_agent_version' })
        .select('id, workspace_id, sender_user_id, recipient_user_id, source_agent_id, source_agent_version, agent_name, template, status, created_at, accepted_at')
        .single();
      if (error) throw error;
      return jsonResponse({ share });
    }

    if (action === 'listAgentShares') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      const { data: shares, error } = await admin
        .from('timewarp_agent_shares')
        .select('id, workspace_id, sender_user_id, recipient_user_id, source_agent_id, source_agent_version, agent_name, template, status, created_at, accepted_at')
        .eq('workspace_id', workspaceId)
        .eq('recipient_user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return jsonResponse({ shares: asArray(shares) });
    }

    if (action === 'acceptAgentShare') {
      const workspaceId = cleanText(body.workspaceId);
      const shareId = cleanText(body.shareId);
      if (!isUuid(workspaceId) || !isUuid(shareId)) return jsonResponse({ error: 'Valid workspaceId and shareId are required.' }, 400);
      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      const { error } = await admin
        .from('timewarp_agent_shares')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', shareId)
        .eq('workspace_id', workspaceId)
        .eq('recipient_user_id', user.id)
        .eq('status', 'pending');
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === 'shareChat') {
      const workspaceId = cleanText(body.workspaceId);
      const recipientUserId = cleanText(body.recipientUserId);
      if (!isUuid(workspaceId) || !isUuid(recipientUserId)) {
        return jsonResponse({ error: 'Valid workspaceId and recipientUserId are required.' }, 400);
      }
      const sender = await loadMembership(admin, user.id, workspaceId);
      if (!sender) return jsonResponse({ error: 'Workspace membership required.' }, 403);
      if (recipientUserId === user.id) return jsonResponse({ error: 'Choose another workspace member.' }, 400);
      const recipient = await loadMembership(admin, recipientUserId, workspaceId);
      if (!recipient) return jsonResponse({ error: 'That person is not an active workspace member.' }, 404);

      const shareLimit = await consumeRateLimit(
        admin,
        user.id,
        'workspace_chat_share',
        envLimit('WORKSPACE_CHAT_SHARE_PER_MINUTE', 30),
        envLimit('WORKSPACE_CHAT_SHARE_PER_DAY', 500),
        'chat share',
      );
      if (!shareLimit.allowed) return rateLimitResponse(shareLimit, corsHeaders);

      const chat = sanitizeSharedChat(body.chat);
      const serializedChat = JSON.stringify(chat);
      if (serializedChat.length > 5_000_000) {
        return jsonResponse({ error: 'That chat is too large to share. Remove large attachments and try again.' }, 413);
      }

      const { data: deliveryRows, error: deliveryError } = await admin.rpc(
        'timewarp_deliver_workspace_chat',
        {
          p_workspace_id: workspaceId,
          p_sender_user_id: user.id,
          p_recipient_user_id: recipientUserId,
          p_title: chat.title,
          p_messages: chat.messages,
          p_artifacts: chat.artifacts,
          p_context_usage: chat.contextUsage,
          p_tokens_used: chat.tokensUsed,
          p_context_attachments: chat.contextAttachments,
        },
      );
      if (deliveryError) throw deliveryError;
      const delivery = asArray(deliveryRows)[0];
      const deliveredChatId = cleanText(delivery?.chat_id);
      if (!deliveredChatId) throw new Error('The shared chat was not persisted in the cloud.');

      return jsonResponse({
        chat: {
          id: deliveredChatId,
          shareId: cleanText(delivery?.share_id),
          title: chat.title,
          recipientUserId,
        },
      });
    }

    if (action === 'invite') {
      const workspaceId = cleanText(body.workspaceId);
      const email = normalizeEmail(body.email);
      const role = normalizeRole(body.role);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: 'Valid email is required.' }, 400);

      const manager = await requireWorkspaceManager(admin, user.id, workspaceId);
      if (!manager.ok) return jsonResponse({ error: manager.error }, manager.status);
      if (role === 'owner' && manager.member.role !== 'owner') {
        return jsonResponse({ error: 'Only owners can invite another owner.' }, 403);
      }

      // Invites send real emails through the Supabase queue — cap them per user so a
      // compromised or abusive account can't turn the app into a spam cannon.
      const inviteLimit = await consumeRateLimit(
        admin,
        user.id,
        'workspace_invite',
        envLimit('WORKSPACE_INVITE_PER_MINUTE', 5),
        envLimit('WORKSPACE_INVITE_PER_DAY', 40),
        'invite',
      );
      if (!inviteLimit.allowed) return rateLimitResponse(inviteLimit, corsHeaders);

      const { data: existingMember, error: existingMemberError } = await admin
        .from('timewarp_workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('email', email)
        .eq('status', 'active')
        .maybeSingle();
      if (existingMemberError) throw existingMemberError;
      if (existingMember) return jsonResponse({ error: 'That person is already in this workspace.' }, 409);

      const { data: existingInvite, error: existingInviteError } = await admin
        .from('timewarp_workspace_invites')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('email', email)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (existingInviteError) throw existingInviteError;
      if (existingInvite) {
        return jsonResponse({ error: 'That person already has a pending invite. Resend or revoke it from the Pending invites tab.' }, 409);
      }

      const { data: workspace, error: workspaceError } = await admin
        .from('timewarp_workspaces')
        .select('name')
        .eq('id', workspaceId)
        .single();
      if (workspaceError) throw workspaceError;

      const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const tokenHash = await hashInviteToken(token);
      const invitedByEmail = normalizeEmail(user.email);
      const inviterName = cleanText(
        user.user_metadata?.name || user.user_metadata?.full_name || invitedByEmail.split('@')[0],
        'A teammate',
      );

      const { data: createdInvite, error: inviteError } = await admin
        .from('timewarp_workspace_invites')
        .insert({
          workspace_id: workspaceId,
          email,
          role,
          token_hash: tokenHash,
          invited_by: user.id,
          invited_by_email: invitedByEmail,
          email_sent: false,
          email_error: null,
          expires_at: inviteExpiry(),
        })
        .select('id, workspace_id, email, role, invited_by, invited_by_email, status, email_sent, email_error, email_message_id, last_email_sent_at, expires_at, accepted_by, accepted_at, created_at, updated_at')
        .single();
      if (inviteError) throw inviteError;

      let emailSent = false;
      let emailError = '';
      let emailMessageId: string | null = null;
      try {
        const queued = await enqueueWorkspaceInviteEmail(admin, {
          inviteId: createdInvite.id,
          token,
          recipientEmail: email,
          workspaceName: cleanText(workspace.name, 'Timewarp workspace'),
          inviterName,
          inviterEmail: invitedByEmail,
          role,
        });
        emailSent = true;
        emailMessageId = queued.messageId;
      } catch (error) {
        emailError = cleanText(error instanceof Error ? error.message : 'Email delivery could not be queued.').slice(0, 1_000);
        console.warn('[timewarp-workspaces] Invite email queue failed:', emailError);
      }

      const { data: invite, error: inviteUpdateError } = await admin
        .from('timewarp_workspace_invites')
        .update({
          email_sent: emailSent,
          email_error: emailError || null,
          email_message_id: emailMessageId,
          last_email_sent_at: emailSent ? new Date().toISOString() : null,
        })
        .eq('id', createdInvite.id)
        .select('id, workspace_id, email, role, invited_by, invited_by_email, status, email_sent, email_error, email_message_id, last_email_sent_at, expires_at, accepted_by, accepted_at, created_at, updated_at')
        .single();
      if (inviteUpdateError) throw inviteUpdateError;

      return jsonResponse({ invite, emailSent, emailError: emailError || null });
    }

    if (action === 'resendInvite') {
      const workspaceId = cleanText(body.workspaceId);
      const inviteId = cleanText(body.inviteId);
      if (!isUuid(workspaceId) || !isUuid(inviteId)) {
        return jsonResponse({ error: 'Valid workspaceId and inviteId are required.' }, 400);
      }

      const manager = await requireWorkspaceManager(admin, user.id, workspaceId);
      if (!manager.ok) return jsonResponse({ error: manager.error }, manager.status);

      const inviteLimit = await consumeRateLimit(
        admin,
        user.id,
        'workspace_invite',
        envLimit('WORKSPACE_INVITE_PER_MINUTE', 5),
        envLimit('WORKSPACE_INVITE_PER_DAY', 40),
        'resend',
      );
      if (!inviteLimit.allowed) return rateLimitResponse(inviteLimit, corsHeaders);

      const { data: pendingInvite, error: inviteError } = await admin
        .from('timewarp_workspace_invites')
        .select('id, workspace_id, email, role, status')
        .eq('id', inviteId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!pendingInvite) return jsonResponse({ error: 'Pending invite not found.' }, 404);

      const { data: workspace, error: workspaceError } = await admin
        .from('timewarp_workspaces')
        .select('name')
        .eq('id', workspaceId)
        .single();
      if (workspaceError) throw workspaceError;

      const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const tokenHash = await hashInviteToken(token);
      const expiresAt = inviteExpiry();
      const { error: rotateError } = await admin
        .from('timewarp_workspace_invites')
        .update({
          token_hash: tokenHash,
          expires_at: expiresAt,
          email_sent: false,
          email_error: null,
          email_message_id: null,
        })
        .eq('id', inviteId);
      if (rotateError) throw rotateError;

      const inviterEmail = normalizeEmail(user.email);
      const inviterName = cleanText(
        user.user_metadata?.name || user.user_metadata?.full_name || inviterEmail.split('@')[0],
        'A teammate',
      );
      let emailSent = false;
      let emailError = '';
      let emailMessageId: string | null = null;
      try {
        const queued = await enqueueWorkspaceInviteEmail(admin, {
          inviteId,
          token,
          recipientEmail: normalizeEmail(pendingInvite.email),
          workspaceName: cleanText(workspace.name, 'Timewarp workspace'),
          inviterName,
          inviterEmail,
          role: normalizeRole(pendingInvite.role),
        });
        emailSent = true;
        emailMessageId = queued.messageId;
      } catch (error) {
        emailError = cleanText(error instanceof Error ? error.message : 'Email delivery could not be queued.').slice(0, 1_000);
        console.warn('[timewarp-workspaces] Invite resend queue failed:', emailError);
      }

      const { data: invite, error: updateError } = await admin
        .from('timewarp_workspace_invites')
        .update({
          email_sent: emailSent,
          email_error: emailError || null,
          email_message_id: emailMessageId,
          last_email_sent_at: emailSent ? new Date().toISOString() : null,
        })
        .eq('id', inviteId)
        .select('id, workspace_id, email, role, invited_by, invited_by_email, status, email_sent, email_error, email_message_id, last_email_sent_at, expires_at, accepted_by, accepted_at, created_at, updated_at')
        .single();
      if (updateError) throw updateError;

      return jsonResponse({ invite, emailSent, emailError: emailError || null });
    }

    if (action === 'acceptInvite') {
      const token = cleanText(body.token);
      if (!token) return jsonResponse({ error: 'Invite token is required.' }, 400);
      const tokenHash = await hashInviteToken(token);
      const { data: invite, error } = await admin
        .from('timewarp_workspace_invites')
        .select('id, workspace_id, email, role, status, expires_at')
        .eq('token_hash', tokenHash)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      if (!invite) return jsonResponse({ error: 'Invite not found or expired.' }, 404);
      if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
        return jsonResponse({ error: 'This invite belongs to another email address.' }, 403);
      }

      const existingMembership = await loadMembership(admin, user.id, invite.workspace_id);
      if (!existingMembership && await countActiveTeamWorkspaces(admin, user.id) >= TEAM_WORKSPACE_LIMIT) {
        return jsonResponse({ error: WORKSPACE_LIMIT_MESSAGE }, 409);
      }

      await acceptInviteRow(admin, invite, user);
      const details = await loadWorkspaceDetails(admin, user.id, invite.workspace_id);
      return jsonResponse({ ok: true, ...details });
    }

    if (action === 'acceptPendingInvites') {
      const email = normalizeEmail(user.email);
      const { data: invites, error } = await admin
        .from('timewarp_workspace_invites')
        .select('id, workspace_id, email, role, status, expires_at')
        .eq('email', email)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;

      const activeCount = await countActiveTeamWorkspaces(admin, user.id);
      const availableSlots = Math.max(0, TEAM_WORKSPACE_LIMIT - activeCount);
      const acceptedInvites = asArray(invites).slice(0, availableSlots);
      for (const invite of acceptedInvites) {
        await acceptInviteRow(admin, invite, user);
      }

      return jsonResponse({
        acceptedCount: acceptedInvites.length,
        skippedCount: Math.max(0, asArray(invites).length - acceptedInvites.length),
      });
    }

    // Compatibility for older clients: contributions are always enabled.
    if (action === 'updateMemorySharingPreferences') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);

      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);

      const { error: updateError } = await admin
        .from('timewarp_workspace_members')
        .update({
          share_connector_data_with_memory: true,
          share_chat_memory_episodes: true,
        })
        .eq('id', member.id)
        .eq('user_id', user.id)
        .eq('workspace_id', workspaceId);
      if (updateError) throw updateError;

      const details = await loadWorkspaceDetails(admin, user.id, workspaceId);
      return jsonResponse({ ok: true, ...details });
    }

    if (action === 'updateMemberRole') {
      const workspaceId = cleanText(body.workspaceId);
      const memberId = cleanText(body.memberId);
      const role = normalizeRole(body.role);
      if (!isUuid(workspaceId) || !isUuid(memberId)) return jsonResponse({ error: 'Valid workspaceId and memberId are required.' }, 400);

      const manager = await requireWorkspaceManager(admin, user.id, workspaceId);
      if (!manager.ok) return jsonResponse({ error: manager.error }, manager.status);
      if (role === 'owner' && manager.member.role !== 'owner') {
        return jsonResponse({ error: 'Only owners can promote another owner.' }, 403);
      }

      const { data: target, error: targetError } = await admin
        .from('timewarp_workspace_members')
        .select('id, user_id, role')
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return jsonResponse({ error: 'Member not found.' }, 404);
      if (target.role === 'owner' && manager.member.role !== 'owner') {
        return jsonResponse({ error: 'Only owners can change owner roles.' }, 403);
      }
      const guarded = await guardedMemberUpdate(admin, workspaceId, memberId, 'set_role', role);
      if (guarded === 'last_owner') {
        return jsonResponse({ error: 'A workspace needs at least one owner.' }, 409);
      }
      if (guarded === 'not_found') {
        return jsonResponse({ error: 'Member not found.' }, 404);
      }
      if (guarded === 'invalid') {
        return jsonResponse({ error: 'Invalid role change.' }, 400);
      }
      if (guarded === 'fallback') {
        if (target.role === 'owner' && role !== 'owner' && (await countActiveOwners(admin, workspaceId)) <= 1) {
          return jsonResponse({ error: 'A workspace needs at least one owner.' }, 409);
        }
        const { error: updateError } = await admin
          .from('timewarp_workspace_members')
          .update({ role })
          .eq('id', memberId);
        if (updateError) throw updateError;
      }

      const details = await loadWorkspaceDetails(admin, user.id, workspaceId);
      return jsonResponse({ ok: true, ...details });
    }

    if (action === 'removeMember') {
      const workspaceId = cleanText(body.workspaceId);
      const memberId = cleanText(body.memberId);
      if (!isUuid(workspaceId) || !isUuid(memberId)) return jsonResponse({ error: 'Valid workspaceId and memberId are required.' }, 400);

      const manager = await requireWorkspaceManager(admin, user.id, workspaceId);
      if (!manager.ok) return jsonResponse({ error: manager.error }, manager.status);

      const { data: target, error: targetError } = await admin
        .from('timewarp_workspace_members')
        .select('id, user_id, role')
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return jsonResponse({ error: 'Member not found.' }, 404);
      if (target.role === 'owner' && manager.member.role !== 'owner') {
        return jsonResponse({ error: 'Only owners can remove another owner.' }, 403);
      }

      const guarded = await guardedMemberUpdate(admin, workspaceId, memberId, 'remove');
      if (guarded === 'last_owner') {
        return jsonResponse({ error: 'A workspace needs at least one owner.' }, 409);
      }
      if (guarded === 'not_found') {
        return jsonResponse({ error: 'Member not found.' }, 404);
      }
      if (guarded === 'fallback' || guarded === 'invalid') {
        if (target.role === 'owner' && (await countActiveOwners(admin, workspaceId)) <= 1) {
          return jsonResponse({ error: 'A workspace needs at least one owner.' }, 409);
        }
        const { error: updateError } = await admin
          .from('timewarp_workspace_members')
          .update({ status: 'removed' })
          .eq('id', memberId);
        if (updateError) throw updateError;
      }

      const details = await loadWorkspaceDetails(admin, user.id, workspaceId);
      return jsonResponse({ ok: true, ...details });
    }

    if (action === 'leaveWorkspace') {
      const workspaceId = cleanText(body.workspaceId);
      if (!isUuid(workspaceId)) return jsonResponse({ error: 'Valid workspaceId is required.' }, 400);

      const member = await loadMembership(admin, user.id, workspaceId);
      if (!member) return jsonResponse({ error: 'Workspace membership required.' }, 403);

      const guarded = await guardedMemberUpdate(admin, workspaceId, member.id, 'remove');
      if (guarded === 'last_owner') {
        return jsonResponse({ error: 'Transfer ownership before leaving this workspace.' }, 409);
      }
      if (guarded === 'not_found') {
        return jsonResponse({ error: 'Workspace membership required.' }, 403);
      }
      if (guarded === 'fallback' || guarded === 'invalid') {
        if (member.role === 'owner' && (await countActiveOwners(admin, workspaceId)) <= 1) {
          return jsonResponse({ error: 'Transfer ownership before leaving this workspace.' }, 409);
        }
        const { error: updateError } = await admin
          .from('timewarp_workspace_members')
          .update({ status: 'removed' })
          .eq('id', member.id);
        if (updateError) throw updateError;
      }

      return jsonResponse({ ok: true });
    }

    if (action === 'revokeInvite') {
      const workspaceId = cleanText(body.workspaceId);
      const inviteId = cleanText(body.inviteId);
      if (!isUuid(workspaceId) || !isUuid(inviteId)) return jsonResponse({ error: 'Valid workspaceId and inviteId are required.' }, 400);

      const manager = await requireWorkspaceManager(admin, user.id, workspaceId);
      if (!manager.ok) return jsonResponse({ error: manager.error }, manager.status);

      const { error } = await admin
        .from('timewarp_workspace_invites')
        .update({ status: 'revoked' })
        .eq('workspace_id', workspaceId)
        .eq('id', inviteId)
        .eq('status', 'pending');
      if (error) throw error;

      const details = await loadWorkspaceDetails(admin, user.id, workspaceId);
      return jsonResponse({ ok: true, ...details });
    }

    return jsonResponse({ error: 'Invalid action.' }, 400);
  } catch (error) {
    if (isWorkspaceLimitError(error)) {
      return jsonResponse({ error: WORKSPACE_LIMIT_MESSAGE }, 409);
    }
    const message = error instanceof Error ? error.message : 'Workspace request failed.';
    console.error('[timewarp-workspaces] request failed:', error);
    return jsonResponse({ error: message }, 500);
  }
});
