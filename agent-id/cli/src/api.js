// Agent ID's HTTP API: JSON in, JSON out, errors as { error: { code, message } }.
import { ApiError, CliError } from './errors.js';
import { VERSION } from './version.js';

// "timewarp-id/1.2.3 (claude-code)" when the tool it runs in is known.
export const userAgent = tool => `timewarp-id/${VERSION}${tool ? ` (${tool})` : ''}`;

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
          ...headers,
        },
        ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      throw new CliError(`Could not reach Agent ID at ${this.base} (${reason}).`, { hint: 'Check your connection, or the API address (--api, AGENT_ID_API).' });
    }
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : {}; } catch { /* plain text */ }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? data.error : null;
      throw new ApiError(response.status, error?.code || `http_${response.status}`, error?.message || `Agent ID answered HTTP ${response.status}.`, data);
    }
    return data;
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, body, options = {}) { return this.request('POST', path, { ...options, body: body ?? {} }); }
  patch(path, body, options = {}) { return this.request('PATCH', path, { ...options, body: body ?? {} }); }
  delete(path, options) { return this.request('DELETE', path, options); }
}
