// The JSON shapes the Agent ID API returns. The service is the spec:
// timewarp/supabase/functions/agent-id (shared.ts, verification.ts, config.ts,
// owner.ts, agent.ts). Keep these in step with it.

export type Kind = "mail" | "phone" | "wallet" | "card" | "vm";
export const KINDS: Kind[] = ["mail", "phone", "wallet", "card", "vm"];

export type Mode = "test" | "live";
export type Runtime = "any" | "timewarp" | "codex" | "claude" | "other";
export const RUNTIMES: Runtime[] = ["codex", "claude", "timewarp", "other", "any"];
export type AgentStatus = "active" | "suspended" | "revoked";
export type VerificationLevel = "kyb" | "kyc" | "none";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

// Money in minor units (cents), with the API's own display string.
export type Money = { amount: number; currency: string; display?: string };

export type ResourceSettings = {
  perTransfer?: number;
  daily?: number;
  approvalAbove?: number;
  perTransaction?: number;
  monthly?: number;
  blockedCategories?: string[];
  allowedCategories?: string[];
  greeting?: string;
  // Wallet: where the owner withdraws to (their own wallet or exchange, on Base).
  withdrawTo?: string;
};

export type ResourceDetails = {
  // Phone
  capabilities?: string[];
  country?: string;
  // Wallet
  network?: string;
  // Card
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  // Machine
  size?: string;
  machine?: string;
};

export type Resource = {
  id: string;
  kind: Kind;
  mode: Mode;
  provider: string;
  status: string;
  address: string | null;
  label: string | null;
  settings: ResourceSettings;
  details: ResourceDetails;
  balance?: Money | null;
  currency: string | null;
  createdAt: string;
};

export type Agent = {
  id: string;
  name: string;
  handle: string;
  runtime: Runtime;
  status: AgentStatus;
  organizationId: string | null;
  desktopAgentId: string | null;
  gitPrincipal: string;
  createdAt: string;
  lastSeenAt: string | null;
  resources: Partial<Record<Kind, Resource>>;
  // Where the agent runs (Claude Code, Codex, Cursor…); null until known.
  origin?: AgentOrigin | null;
  // Every app this one Agent ID is used in, most recent first.
  apps?: AgentApp[];
};

export type AgentApp = {
  app: string;
  label: string;
  clientName?: string | null;
  lastSeenAt?: string | null;
  firstSeenAt?: string | null;
};

export type AgentOrigin = {
  app: string;
  label: string;
  detail: string | null;
  client: { name: string; version: string | null; seenAt: string | null } | null;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

export type SigningKey = {
  id: string;
  name: string;
  fingerprint: string;
  publicKey: string;
  createdAt: string;
};

export type AgentDetail = {
  agent: Agent;
  keys: ApiKey[];
  signingKeys: SigningKey[];
  verification: { verified: boolean; level: VerificationLevel };
};

// What a new agent was given at once, and what was left out and why
// (owner not verified, free plan, not offered here).
export type AgentSetup = {
  given: Kind[];
  skipped: { kind: Kind; code: string; message: string }[];
};
export type CreatedAgent = { agent: Agent; setup?: AgentSetup; key?: ApiKey; secret?: string };
export type CreatedKey = { key: ApiKey; secret: string };

export type EventKind = "mail" | "sms" | "call" | "wallet" | "card" | "vm";
export type AgentEvent = {
  id: string;
  kind: EventKind;
  direction: "in" | "out" | "none";
  status: string;
  counterparty: string | null;
  subject: string | null;
  text: string | null;
  amount: Money | null;
  thread: string | null;
  data: Record<string, unknown>;
  read: boolean;
  at: string;
};
export type EventPage = { events: AgentEvent[]; more: boolean };

export type ResourceAvailability = {
  live: boolean;
  provider: string;
  verificationRequired: boolean;
  paidPlanRequired: boolean;
  // Why it isn't live: not switched on yet, or switched on without its provider.
  unavailable?: "not_enabled" | "not_configured";
  // Cards: people apply for early access instead of getting one.
  waitlist?: boolean;
};

export type PublicConfig = {
  issuer: string;
  api: string;
  mcp: string;
  jwks: string;
  mailDomain: string;
  resources: Record<Kind, ResourceAvailability>;
  verification: {
    person: "stripe_identity" | "test" | "manual";
    business: "test" | "manual";
    requiredToCreateAgents: boolean;
  };
  passports: { available: boolean; lifetimeSeconds: number };
  // True on development deployments: test resources, test money.
  testMode?: boolean;
  legal?: { termsVersion: string; termsUrl: string; privacyUrl: string };
};

export type Person = {
  status: VerificationStatus;
  provider?: string;
  legalName?: string | null;
  country?: string | null;
  verifiedAt?: string | null;
  lastError?: string | null;
  consentAt?: string | null;
};

export type VatCheck = {
  status: "valid" | "invalid" | "unavailable" | "not_applicable";
  number?: string | null;
  name?: string | null;
  address?: string | null;
  at?: string;
};

export type Business = {
  status: VerificationStatus;
  legalName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  country?: string | null;
  website?: string | null;
  representativeRole?: string | null;
  // The registration certificate or registry extract, for reviewers.
  document?: { name: string } | null;
  checks?: { vat?: VatCheck };
  verifiedAt?: string | null;
  note?: string | null;
};

export type Organization = { id: string; name: string; role: string; business: Business };

export type Account = {
  user: { id: string; email: string | null; name?: string | null };
  person: Person;
  organizations: Organization[];
  plan: string;
  reviewer: boolean;
  agents: { count: number; max: number };
  config: PublicConfig;
  // version/acceptedAt: what the user last accepted; current: the version in force.
  terms?: {
    accepted: boolean;
    version: string | null;
    acceptedAt: string | null;
    current?: string;
  };
};

export type Approval = {
  id: string;
  agentId: string;
  agentName: string | null;
  kind: "wallet_transfer";
  request: { to?: string; amount?: number; currency?: string; memo?: string | null };
  status: "pending" | "approved" | "denied" | "completed" | "failed";
  reason: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

export type AuditEntry = {
  id: number | string;
  agentId: string | null;
  actor: "owner" | "agent" | "system" | "provider" | "relying_party";
  action: string;
  detail: Record<string, unknown>;
  at: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  wallet: string | null;
  note: string | null;
  updatedAt: string;
};

export type PolicyRequire = "any" | "verified" | "kyc" | "kyb";
export type RelyingPartyPolicy = {
  require?: PolicyRequire;
  organizations?: string[];
  agents?: string[];
};
export type RelyingParty = {
  id: string;
  name: string;
  audience: string;
  organizationId: string | null;
  policy: RelyingPartyPolicy;
  secretPrefix: string;
  createdAt: string;
  revoked: boolean;
};

export type PersonReview = Person & { userId: string; submittedAt: string };
export type BusinessReview = Business & {
  organizationId: string;
  submittedBy: string | null;
  submittedAt: string;
};

// What the agent ("me") routes return when the owner acts as an agent.
export type WalletSummary = {
  address: string | null;
  mode: Mode;
  label?: string | null;
  network?: string;
  provider?: string;
  currency?: string | null;
  balance: Money | null;
  assets?: { asset: string; amount: number }[];
  balanceError?: string;
  limits: ResourceSettings;
  sent: { last24Hours: Money | null; last30Days: Money | null };
};

export type CardSummary = ResourceDetails & {
  label: string | null;
  mode: Mode;
  status: string;
  currency: string | null;
  limits: ResourceSettings;
  spent: { last24Hours: Money | null; last30Days: Money | null };
};

export type MachineSummary = {
  label: string | null;
  mode: Mode;
  status: string;
  state: string;
  size?: string;
  note?: string;
};

// Adding money to a wallet: its address on Base, and buying by card where offered.
export type AddMoneyInfo = {
  address: string | null;
  mode: Mode;
  network: { id: string; name: string } | null;
  assets: string[];
  card: { available: boolean };
  test: boolean;
};

export type CardOnrampSession = { clientSecret: string; publishableKey: string; url?: string };

export type WithdrawResult = { status: "completed" | "pending"; transfer: AgentEvent };

export type TransferResult =
  | { status: "needs_approval"; approval: string; message: string }
  | { status: "completed"; transfer: AgentEvent; balance?: Money };

export type TestChargeResult = { approved: boolean; reason?: string; transaction: AgentEvent };

export type CommandResult = { exitCode: number; stdout: string; stderr: string; seconds: number };

export type BillingAddress = {
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  state?: string;
  country: string;
};

export type ProvisionInput = {
  kind: Kind;
  mode: Mode;
  settings?: ResourceSettings;
  options?: {
    size?: "small" | "medium";
    country?: string;
    areaCode?: string;
    billing?: BillingAddress;
    currency?: string;
  };
};

// --- Mail -------------------------------------------------------------------------

export type MailFolder = "inbox" | "sent" | "trash";

export type FileRef = { id: string; filename: string; contentType: string; size: number };

export type MailMessage = AgentEvent & {
  folder?: MailFolder;
  attachments?: FileRef[];
  preview?: string;
};

export type MailPage = { messages: MailMessage[]; more: boolean };

export type MailCounts = {
  inbox: { total: number; unread: number };
  sent: { total: number };
  trash: { total: number };
};

// --- Card early access --------------------------------------------------------------

export type CardApplication = {
  status: string;
  useCase: string;
  monthlySpend: Money | null;
  country: string;
  createdAt: string;
};

// --- Phone number early access -------------------------------------------------------

export type PhoneUse = "sms" | "calls";
export type PhoneApplication = {
  status: string;
  useCase: string;
  country: string | null;
  uses: PhoneUse[];
  createdAt: string;
};

// --- Machine files ------------------------------------------------------------------

export type VmEntry = {
  name: string;
  type: "file" | "dir" | "link";
  size: number | null;
  modifiedAt: string | null;
};
export type VmListing = { path: string; entries: VmEntry[] };

// --- Operators (Agent ID staff) -------------------------------------------------------

export type AdminStatus = {
  passports: boolean;
  phoneWebhooks: boolean;
  resources: Record<
    Kind,
    { enabled: boolean; configured: boolean; live: boolean; provider: string }
  >;
  verification: { person: string; business: string };
  webhooks: Record<"stripe" | "resend", { needed: boolean; registered: boolean; url: string }>;
};

export type AdminSetup = {
  setup: Record<"stripe" | "resend", "registered" | "kept" | "not_needed" | string>;
  status: AdminStatus;
};
