// Timewarp Agent ID on Supabase Edge Functions. The service itself is app.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { createHandler } from './app.ts';

const url = Deno.env.get('SUPABASE_URL') || '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A session for someone who just proved their email with a claim code: the
// same as following a magic link. A throwaway client verifies it, so the
// shared admin client never takes on the person's session.
async function signIn(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(error?.message || 'No sign-in link.');
  const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  const session = verified.data?.session;
  if (verified.error || !session) throw new Error(verified.error?.message || 'No session.');
  return { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, expires_at: session.expires_at, user: session.user };
}

// Keeps the function alive until work started for a request finishes (a new
// agent's mail, wallet, number and machine), after the answer has gone.
function background(work: Promise<unknown>) {
  const tracked = work.catch(error => console.error('[agent-id] background', error?.message));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(tracked); } catch { /* runs anyway */ }
}

Deno.serve(createHandler({ admin, env: name => Deno.env.get(name) || '', signIn, background }));
