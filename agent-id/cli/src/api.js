// Agent ID's HTTP API: JSON in, JSON out, errors as { error: { code, message } }.
import { hostname } from 'node:os';
import { ApiError, CliError } from './errors.js';
import { VERSION } from './version.js';
import { DEFAULT_API } from './config.js';

// "timewarp-id/1.2.3 (claude-code)" when the tool it runs in is known.
export const userAgent = tool => `timewarp-id/${VERSION}${tool ? ` (${tool})` : ''}`;

// This computer's name, so the owner's activity log says where an agent ran.
const device = () => { try { return hostname().replace(/[^\w .@()-]/g, '').slice(0, 64); } catch { return ''; } };

export class Api {
  constructor(base, fetchImpl = globalThis.fetch, { tool = null } = {}) {
    this.base = base;
    this.fetch = fetchImpl;
    this.tool = tool;
  }

  // `raw` sends bytes as they are (file uploads), with `headers` saying what they are.
  async request(method, path, { token, body, raw, query, headers = {} } = {}) {
    const search = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString() : '';
    const url = `${this.base}${path}${search ? `?${search}` : ''}`;
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined && raw === undefined ? { 'content-type': 'application/json' } : {}),
          accept: 'application/json',
          'user-agent': userAgent(this.tool),
          ...(device() ? { 'timewarp-device': device() } : {}),
          ...headers,
        },
        ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      // Production's address means nothing to people; another one is a developer's.
      throw new CliError('Can\'t reach Agent ID. Check your internet connection and try again.', {
        code: 'network', hint: this.base === DEFAULT_API ? undefined : `Tried ${this.base} (${reason}); change it with --api or AGENT_ID_API.`,
      });
    }
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : {}; } catch { /* plain text */ }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? data.error : null;
      const message = error?.message || (response.status >= 500 ? `Agent ID isn't answering right now (HTTP ${response.status}). Try again in a minute.` : `Agent ID answered HTTP ${response.status}.`);
      throw new ApiError(response.status, error?.code || `http_${response.status}`, message, data);
    }
    return data;
  }

  // A file's bytes as they are (GET /v1/me/files/:id).
  async bytes(path, { token } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.base}${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': userAgent(this.tool), ...(device() ? { 'timewarp-device': device() } : {}) } });
    } catch {
      throw new CliError("Can't reach Agent ID. Check your internet connection and try again.", { code: 'network' });
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(response.status, data?.error?.code || `http_${response.status}`, data?.error?.message || `Agent ID answered HTTP ${response.status}.`, data);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, body, options = {}) { return this.request('POST', path, { ...options, body: body ?? {} }); }
  patch(path, body, options = {}) { return this.request('PATCH', path, { ...options, body: body ?? {} }); }
  delete(path, options) { return this.request('DELETE', path, options); }
}
