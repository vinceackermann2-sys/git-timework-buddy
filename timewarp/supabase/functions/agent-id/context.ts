// What every handler works with. Tests pass their own database, clock and
// network so the same code runs against PGlite and scripted providers.
import type { Config } from './config.ts';

export type Ctx = {
  admin: any;
  config: Config;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  // Signs a person in (as a magic link would) once they've proved their email.
  signIn?: (email: string) => Promise<{ access_token: string; refresh_token: string; expires_in: number } | null>;
};

export type AgentRow = {
  id: string; owner_user_id: string; workspace_id: string | null; name: string; handle: string;
  runtime: string; origin_detail?: string | null; client_name?: string | null; client_version?: string | null; client_seen_at?: string | null; status: string; desktop_agent_id: string | null; created_at: string; updated_at: string; last_seen_at: string | null;
};
export type ResourceRow = {
  id: string; agent_id: string; owner_user_id: string; kind: 'mail' | 'phone' | 'wallet' | 'card' | 'vm'; provider: string; mode: 'live' | 'test';
  provider_ref: string | null; address: string | null; label: string | null; status: string; settings: Record<string, any>; state: Record<string, any>;
  balance_minor: number; currency: string | null; created_at: string; updated_at: string; released_at: string | null;
};
