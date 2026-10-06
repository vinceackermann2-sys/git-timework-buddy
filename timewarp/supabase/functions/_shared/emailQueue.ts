export const dispatchEmailQueue = async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Email queue dispatch is not configured.');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/process-email-queue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw }; }
  if (!response.ok) throw new Error(String(body.error || `Email queue dispatch failed (${response.status}).`));
  return body;
};
