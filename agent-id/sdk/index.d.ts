// Types for @timewarp/agent-id-verify.

export declare const DEFAULT_API: string;
export declare const PASSPORT_HEADER: 'Agent-Passport';

/** How verified the agent's owner must be. `verified` = a verified person (KYC) or business (KYB). */
export type Requirement = 'any' | 'verified' | 'kyc' | 'kyb';
export type VerificationLevel = 'none' | 'kyc' | 'kyb';

export type ErrorCode =
  | 'passport_required' | 'malformed' | 'bad_signature' | 'unknown_key' | 'wrong_issuer'
  | 'expired' | 'not_yet_valid' | 'wrong_audience'
  | 'owner_not_verified' | 'organization_not_allowed' | 'agent_not_allowed'
  | 'config_unavailable' | 'jwks_unavailable' | 'unavailable'
  | (string & {});

export declare class AgentIdError extends Error {
  readonly name: 'AgentIdError';
  /** Machine-readable reason, e.g. `expired` or `owner_not_verified`. */
  readonly code: ErrorCode;
  /** The HTTP status a service should answer with: 401 (no valid passport), 403 (policy), 5xx (Agent ID unreachable or misconfigured). */
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status?: number, details?: unknown);
}

export interface PassportClaims {
  iss: string;
  /** The agent id, `agt_…`. */
  sub: string;
  aud: string | string[];
  iat: number;
  nbf?: number;
  exp: number;
  /** Passport id. */
  jti: string;
  agent: { name: string; handle: string; runtime: string; principal: string; model?: AgentModel };
  owner: {
    /** Stable for your audience, different for every other audience. */
    ref: string;
    type: 'person' | 'business';
    verified: boolean;
    level: VerificationLevel;
    name?: string;
    country?: string;
  };
  org: { id: string; name: string | null; verified: boolean } | null;
  /** What the agent has: mail, phone, wallet, card, vm. */
  resources: string[];
  [claim: string]: unknown;
}

/** What kind of AI the agent is, and its maker and model, as its owner says. */
export interface AgentModel {
  kind: 'agent' | 'llm' | 'image' | 'voice' | 'video' | 'code' | 'text' | 'decision' | 'other';
  provider?: string;
  name?: string;
}

export interface VerifiedAgent {
  agent: { id: string; name: string; handle: string; runtime: string; principal: string; model?: AgentModel };
  owner: PassportClaims['owner'];
  org: PassportClaims['org'];
  claims: PassportClaims;
  /** Set when an online check ran (middleware with `online`). */
  online?: OnlineCheck;
}

export interface CommonOptions {
  /** Agent ID's API base. Default: production (DEFAULT_API). */
  api?: string;
  /** A fetch implementation, for runtimes or tests that need their own. */
  fetch?: typeof fetch;
}

export interface VerifyOptions extends CommonOptions {
  /** The audience (or audiences) your service accepts, usually its URL. Required. */
  audience: string | string[];
  /** Expected issuer. Default: read from `<api>/v1/config`. */
  issuer?: string;
  /** Where the public keys are. Default: read from `<api>/v1/config`. */
  jwksUrl?: string;
  /** Default `verified`. */
  require?: Requirement;
  /** Only agents of these organizations. */
  organizations?: string[];
  /** Only these agents (`agt_…`). */
  agents?: string[];
  /** Allowed clock skew for exp/nbf. Default 30. */
  clockToleranceSeconds?: number;
}

export interface OnlineCheck {
  valid: boolean;
  allowed?: boolean;
  reason?: string;
  message?: string;
  reasons?: string[];
  agent?: { id: string; name: string; runtime: string; status: string; principal: string; organizationId: string | null };
  owner?: { ref: string; verified: boolean; level: VerificationLevel; business?: string };
  passport?: { id: string; issuedAt: string; expiresAt: string };
}

export interface CheckOptions extends CommonOptions {
  /** The audience your service accepts passports for (the one the passport was issued for). */
  audience: string;
  /** The policy `allowed` is judged by. Default `verified`. */
  require?: Requirement;
  /** Only agents of these organizations are `allowed`. */
  organizations?: string[];
}

export interface AllowedSignersOptions extends CommonOptions {
  /** Your organization's id. */
  organization: string;
  /** 'text' (default): the allowed_signers file; 'json': its lines and the agents left out. */
  format?: 'text' | 'json';
}

export interface MiddlewareOptions extends VerifyOptions {
  /** Also ask Agent ID on every request, which catches an agent revoked or paused a moment ago. No account needed. */
  online?: boolean;
}

/** Checks a passport's signature, issuer, audience, time and your policy, offline. Throws AgentIdError. */
export declare function verifyPassport(token: string, options: VerifyOptions): Promise<VerifiedAgent>;
/** Asks Agent ID about a passport now (POST /v1/verify). Returns the answer; does not throw for an invalid passport. */
export declare function checkPassport(token: string, options: CheckOptions): Promise<OnlineCheck>;
/** Git's allowed_signers file for an organization's agents. */
export declare function fetchAllowedSigners(options: AllowedSignersOptions & { format?: 'text' }): Promise<string>;
export declare function fetchAllowedSigners(options: AllowedSignersOptions & { format: 'json' }): Promise<{ signers: string[]; skipped: { agent: string; reasons: string[] }[]; generatedAt: string }>;
/** The passport from an `Agent-Passport` header, or `Authorization: AgentPassport <jwt>`. */
export declare function passportFrom(request: Request | { headers: Headers | Record<string, string | string[] | undefined> } | Headers | Record<string, string | string[] | undefined>): string | null;

/** Express/Connect middleware: sets `req.agent`, or answers 401/403 JSON. */
export declare function agentIdMiddleware(options: MiddlewareOptions): (req: any, res: any, next?: (error?: unknown) => void) => Promise<void>;
/** Wraps a fetch-style handler (Workers, Hono, Next, Deno, Bun). The verified agent is the handler's second argument. */
export declare function withAgentId<Rest extends unknown[]>(
  handler: (request: Request, agent: VerifiedAgent, ...rest: Rest) => Response | Promise<Response>,
  options: MiddlewareOptions,
): (request: Request, ...rest: Rest) => Promise<Response>;
