// Files agents send and receive, such as mail attachments: the bytes in the
// private agent-id-files storage bucket, who they belong to in agent_id_files.
// Only the agent (or its owner acting as it) can read its own files.
import { checked, fail, str } from './util.ts';
import type { Ctx } from './context.ts';

export const BUCKET = 'agent-id-files';
export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 25 * 1024 * 1024;

export const fileView = (row: any) => ({ id: row.id, filename: row.filename, contentType: row.content_type, size: Number(row.size), createdAt: row.created_at });
const safeName = (name: string) => name.replace(/[\\/\u0000-\u001f<>:"|?*]+/g, '_').replace(/^\.+/, '_').slice(0, 200) || 'file';
const contentTypeOf = (value: unknown) => {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) && type.length <= 150 ? type : 'application/octet-stream';
};

// Stores bytes as a new file of this agent.
export async function saveFile(ctx: Ctx, agent: { id: string; owner_user_id: string }, input: { filename: string; contentType?: string; bytes: Uint8Array; eventId?: string | null }) {
  if (input.bytes.byteLength > MAX_FILE) throw fail(413, 'too_large', 'A file can be at most 10 MB.');
  const id = crypto.randomUUID(), filename = safeName(str(input.filename, 255, 'filename') || 'file');
  const path = `${agent.owner_user_id}/${agent.id}/${id}/${filename}`;
  const contentType = contentTypeOf(input.contentType);
  const { error } = await ctx.admin.storage.from(BUCKET).upload(path, input.bytes, { contentType, upsert: false });
  if (error) { console.error('[agent-id] file upload', error.message); throw fail(503, 'unavailable', 'The file could not be stored. Try again.'); }
  return checked(await ctx.admin.from('agent_id_files').insert({ id, agent_id: agent.id, owner_user_id: agent.owner_user_id, event_id: input.eventId ?? null, filename, content_type: contentType, size: input.bytes.byteLength, storage_path: path }).select('*').single());
}

// The agent's own files with these ids, all of them or an error.
export async function ownFiles(ctx: Ctx, agentId: string, ids: unknown) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))) throw fail(400, 'invalid', 'attachments is a list of up to 10 file ids.');
  if (!ids.length) return [];
  const rows = (checked(await ctx.admin.from('agent_id_files').select('*').eq('agent_id', agentId).in('id', ids)) || []) as any[];
  if (rows.length !== new Set(ids).size) throw fail(404, 'not_found', 'An attachment was not found. Upload it again.');
  if (rows.reduce((sum, row) => sum + Number(row.size), 0) > MAX_ATTACHMENTS) throw fail(413, 'too_large', 'Attachments can add up to at most 25 MB.');
  return rows;
}

export async function fileBytes(ctx: Ctx, row: any) {
  const { data, error } = await ctx.admin.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) throw fail(503, 'unavailable', 'The file could not be read. Try again.');
  return new Uint8Array(await data.arrayBuffer());
}

// Gives another agent's message a copy of these files (the same stored
// bytes, its own record).
export async function shareFiles(ctx: Ctx, rows: any[], to: { agent_id: string; owner_user_id: string }, eventId: string) {
  if (!rows.length) return;
  checked(await ctx.admin.from('agent_id_files').insert(rows.map(row => ({ agent_id: to.agent_id, owner_user_id: to.owner_user_id, event_id: eventId, filename: row.filename, content_type: row.content_type, size: row.size, storage_path: row.storage_path }))).select('id'));
}

export async function filesOf(ctx: Ctx, eventIds: string[]) {
  if (!eventIds.length) return new Map<string, any[]>();
  const rows = (checked(await ctx.admin.from('agent_id_files').select('*').in('event_id', eventIds).order('created_at')) || []) as any[];
  const map = new Map<string, any[]>();
  for (const row of rows) map.set(row.event_id, [...(map.get(row.event_id) || []), fileView(row)]);
  return map;
}

// Removes files from a message deleted for good. Bytes another agent's copy
// still uses stay.
export async function removeFiles(ctx: Ctx, eventId: string) {
  const rows = (checked(await ctx.admin.from('agent_id_files').delete().eq('event_id', eventId).select('storage_path')) || []) as any[];
  for (const row of rows) {
    const others = (checked(await ctx.admin.from('agent_id_files').select('id').eq('storage_path', row.storage_path).limit(1)) || []) as any[];
    if (!others.length) await ctx.admin.storage.from(BUCKET).remove([row.storage_path]);
  }
}
