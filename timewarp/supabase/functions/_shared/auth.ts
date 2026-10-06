// Resolves the caller's Supabase user from a request's Authorization header.
//
// Every function used to build a throwaway client with
// `global: { headers: { Authorization: authHeader } }` and then call
// `getUser()` with no argument. That form makes supabase-js take its *browser*
// path: it looks for a session in storage, finds none inside an edge function,
// and only survives because of an internal `hasCustomAuthorizationHeader` flag
// (GoTrueClient `_getUser` -> `_useSession`). Three things could knock that
// path over, and none of them touch PostgREST — which is why the database kept
// working while every function 401'd:
//
//   * the client was built with SUPABASE_ANON_KEY, so a missing or rotated
//     anon key broke authentication even for a perfectly good user token;
//   * the functions imported `npm:@supabase/supabase-js@2`, an unpinned range
//     re-resolved at deploy time, so a release that changed the session path
//     would break auth with no change on our side;
//   * a blank Authorization header produced the same opaque 401 as a rejected
//     one, so the logs could not tell "signed out" from "server misconfigured".
//
// Passing the token to `getUser(token)` explicitly skips storage, locks and
// that flag entirely: it is a single GET /auth/v1/user with the token as the
// bearer. The apikey it travels with is the service-role key, which each
// function already checks for, so authentication no longer depends on the anon
// key at all.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.106.2';

// Supabase's generated-schema generics collapse to `never` when this shared
// helper is typechecked without a project Database type. Edge functions use a
// service-role client against several tables, so keep that schema intentionally
// open while retaining the SDK's auth method and response types.
export type AdminSupabaseClient = SupabaseClient<any, 'public'>;

export type AuthFailure =
  /** No Authorization header reached us at all. */
  | 'missing_token'
  /** The caller sent its publishable key rather than a session — signed out. */
  | 'not_signed_in'
  /** A real-looking token that Supabase Auth would not accept. */
  | 'rejected';

export interface AuthResult {
  user: User | null;
  failure: AuthFailure | null;
  /** Safe to hand back to the caller: names which of the three cases happened. */
  message: string;
}

const FAILURE_MESSAGES: Record<AuthFailure, string> = {
  missing_token: 'Not authenticated: the request carried no Authorization header.',
  not_signed_in: 'Not authenticated: no active session. Sign in again.',
  rejected: 'Not authenticated: the session token was rejected. Sign in again.',
};

/** Strip the scheme so `getUser` receives a bare JWT. */
export const bearerToken = (authHeader: string): string =>
  (authHeader || '').replace(/^Bearer\s+/i, '').trim();

/** A user access token always carries `sub`. The publishable key is a JWT too,
 *  so when the client has no session it arrives here looking plausible — and
 *  supabase-js really does fall back to sending it (`fetchWithAuth` uses
 *  `accessToken ?? supabaseKey`). Separating the two turns the signed-out case
 *  into its own message instead of a blanket 401.
 *
 *  Diagnostic only. These claims are unverified, so this never admits a caller;
 *  it can only sharpen a rejection. Authority stays with `getUser`. */
const looksLikeUserToken = (token: string): boolean => {
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims?.sub === 'string' && claims.sub.length > 0;
  } catch {
    return false;
  }
};

/** Resolve the caller from a raw Authorization header, or say precisely why we
 *  could not. `admin` must be a service-role client — its key is what
 *  authorises the lookup, while the caller's token rides in as the bearer. */
export const authenticateHeader = async (
  authHeader: string,
  admin: AdminSupabaseClient,
): Promise<AuthResult> => {
  const fail = (failure: AuthFailure): AuthResult => ({
    user: null,
    failure,
    message: FAILURE_MESSAGES[failure],
  });

  const token = bearerToken(authHeader);
  if (!token) return fail('missing_token');
  if (!looksLikeUserToken(token)) return fail('not_signed_in');

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return fail('rejected');

  return { user: data.user, failure: null, message: '' };
};

/** Request-level wrapper for the handlers that have the whole `Request`. */
export const authenticateRequest = (
  req: Request,
  admin: AdminSupabaseClient,
): Promise<AuthResult> =>
  authenticateHeader(req.headers.get('Authorization') || '', admin);

/** Convenience for the functions that only need "the user or nothing". */
export const resolveUser = async (
  authHeader: string,
  admin: AdminSupabaseClient,
): Promise<User | null> => (await authenticateHeader(authHeader, admin)).user;

export { createClient };
