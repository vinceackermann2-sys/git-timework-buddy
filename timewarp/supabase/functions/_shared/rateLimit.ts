// Per-user rate limiting for edge functions, backed by the
// timewarp_consume_rate_limit Postgres function (see the
// 20260712090000_multiuser_hardening migration).
//
// Fail-open by design: if the counter table/function is unavailable the
// request is allowed and a warning is logged — quota is cost protection,
// not data protection, so availability wins.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  message?: string;
}

export const envLimit = (name: string, fallback: number): number => {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export async function consumeRateLimit(
  admin: any,
  userId: string,
  kind: string,
  maxPerMinute: number,
  maxPerDay: number,
  friendlyLabel: string,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await admin.rpc('timewarp_consume_rate_limit', {
      p_user_id: userId,
      p_kind: kind,
      p_max_per_minute: maxPerMinute,
      p_max_per_day: maxPerDay,
    });
    if (error) {
      console.warn(`[rate-limit:${kind}] check unavailable, allowing request:`, error.message);
      return { allowed: true };
    }
    const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (record.allowed === false) {
      const retryAfterSeconds = Number(record.retry_after_seconds) || 60;
      const window = record.limit === 'day' ? 'daily' : 'per-minute';
      return {
        allowed: false,
        retryAfterSeconds,
        message: `You have reached your ${window} ${friendlyLabel} limit. Please try again ${
          record.limit === 'day' ? 'tomorrow' : 'in a minute'
        }.`,
      };
    }
    return { allowed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[rate-limit:${kind}] check failed, allowing request:`, message);
    return { allowed: true };
  }
}

export const rateLimitResponse = (result: RateLimitResult, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: result.message || 'Rate limit exceeded. Please slow down.' }), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfterSeconds || 60),
    },
  });
