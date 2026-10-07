"use strict";
const { assertCloudSafe } = require('../shared/privacy.cjs');
const fail = (status, message) => Object.assign(new Error(message), { status });

function createReporting({ config, auth, fetcher = fetch }) {
  return async function submitFeedback(input) {
    if (typeof input?.description !== 'string' || !input.description.trim()) throw fail(400, 'Add a description before sending.');
    const description = input.description.trim();
    if (description.length > 5000) throw fail(400, 'Keep your report under 5,000 characters.');
    const environment = input.environment || {};
    // Only explicitly submitted text and basic app context leave this device.
    const payload = assertCloudSafe({
      kind: 'feedback', description,
      route: typeof input.route === 'string' ? input.route.slice(0, 2000) : null,
      conversationId: typeof input.conversationId === 'string' ? input.conversationId.slice(0, 160) : null,
      environment: {
        app: environment.app || 'desktop',
        appVersion: environment.appVersion || null,
        releaseChannel: environment.releaseChannel || null,
        platform: environment.platform || process.platform,
      },
    });
    const token = await auth.accessToken();
    const response = await fetcher(`${config.supabaseUrl}/functions/v1/contact`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw fail(response.status, typeof result?.error === 'string' ? result.error : 'Your report could not be saved. Try again.');
    if (result?.ok !== true || !/^[0-9]{8}_[a-f0-9]{16}$/.test(result.traceId || '') || !/^[a-f0-9-]{36}$/i.test(result.ticketId || '')) {
      throw fail(502, 'Your report could not be confirmed. Try again.');
    }
    // Preserve the native feedback router's strict response contract.
    return { traceId: result.traceId };
  };
}

module.exports = { createReporting };
