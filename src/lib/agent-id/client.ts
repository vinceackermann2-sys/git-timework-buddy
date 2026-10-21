// A small typed client for the Agent ID API. The dashboard calls it as the
// signed-in owner (a Supabase session, or a dev token); `agent` names one of
// the owner's agents (the Timewarp-Agent header) for the agent ("me") routes.
import type {
  Account,
  AddMoneyInfo,
  BankAccount,
  BankCurrency,
  BankDeposit,
  BankPayin,
  Mascot,
  BankStatus,
  CardOnrampSession,
  AdminSetup,
  AdminStatus,
  AgentDetail,
  AgentEvent,
  Agent,
  ApiKey,
  Approval,
  AuditEntry,
  BusinessReview,
  CardApplication,
  PhoneApplication,
  PhoneUse,
  CardSummary,
  CommandResult,
  Contact,
  CreatedAgent,
  CreatedKey,
  EventKind,
  EventPage,
  FileRef,
  Kind,
  MailCounts,
  MailFolder,
  MailMessage,
  MailPage,
  MachineSummary,
  Money,
  PersonReview,
  Business,
  Person,
  PolicyRequire,
  ProvisionInput,
  PublicConfig,
  RelyingParty,
  RelyingPartyPolicy,
  Resource,
  ResourceSettings,
  Runtime,
  SigningKey,
  TestChargeResult,
  TransferResult,
  VmListing,
  WalletSummary,
  NewBankAccount,
  WithdrawResult,
} from "./types";

export class AgentIdError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentIdError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Env = Record<string, string | boolean | undefined>;

const trimSlash = (value: string) => value.replace(/\/+$/, "");

// Where the API lives: VITE_AGENT_ID_API, else the Supabase function.
export function resolveApiBase(env: Env): string {
  const explicit = typeof env["VITE_AGENT_ID_API"] === "string" ? env["VITE_AGENT_ID_API"] : "";
  if (explicit.trim()) return trimSlash(explicit.trim());
  const supabase = typeof env["VITE_SUPABASE_URL"] === "string" ? env["VITE_SUPABASE_URL"] : "";
  if (supabase.trim()) return `${trimSlash(supabase.trim())}/functions/v1/agent-id`;
  return "";
}

// The Supabase gateway wants the project's publishable key; a separate API
// (the local dev API) doesn't need it.
export function resolveGatewayKey(env: Env): string | undefined {
  const explicit = typeof env["VITE_AGENT_ID_API"] === "string" ? env["VITE_AGENT_ID_API"] : "";
  if (explicit.trim()) return undefined;
  const key = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  return typeof key === "string" && key ? key : undefined;
}

export function resolveDevToken(env: Env): string | undefined {
  const token = env["VITE_AGENT_ID_DEV_TOKEN"];
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(base: string, path: string, query?: Query): string {
  const url = `${trimSlash(base)}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  // A file sent as the raw body (uploads), with its own headers.
  raw?: { body: Blob; headers: Record<string, string> };
  // Return the response as a Blob (downloads).
  blob?: boolean;
  agent?: string;
  signal?: AbortSignal;
};

export type ClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null | undefined>;
  gatewayKey?: string | undefined;
  fetch?: typeof fetch;
};

// The error an API response carries, or a friendly one when it has none.
export async function errorFromResponse(response: Response): Promise<AgentIdError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : null;
  if (error && typeof error === "object") {
    const { code, message, ...details } = error as Record<string, unknown>;
    if (typeof message === "string" && message) {
      return new AgentIdError(
        response.status,
        typeof code === "string" ? code : "error",
        message,
        details,
      );
    }
  }
  const fallback =
    response.status === 401
      ? "Your session has expired. Sign in again."
      : response.status === 404
        ? "Agent ID couldn't find that."
        : response.status >= 500
          ? `Agent ID is having trouble right now (HTTP ${response.status}). Try again in a moment.`
          : `Agent ID couldn't complete the request (HTTP ${response.status}).`;
  return new AgentIdError(response.status, `http_${response.status}`, fallback);
}

export function createAgentIdClient(options: ClientOptions) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!options.baseUrl) {
      throw new AgentIdError(
        0,
        "not_configured",
        "Agent ID isn't configured on this site (no API address).",
      );
    }
    const token = await options.getToken();
    if (!token) throw new AgentIdError(401, "unauthenticated", "Sign in to continue.");
    const hasBody = opts.body !== undefined || opts.raw !== undefined;
    const method = opts.method ?? (hasBody ? "POST" : "GET");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (options.gatewayKey) headers["apikey"] = options.gatewayKey;
    if (opts.agent) headers["Timewarp-Agent"] = opts.agent;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.raw) Object.assign(headers, opts.raw.headers);
    let response: Response;
    try {
      response = await doFetch(buildUrl(options.baseUrl, path, opts.query), {
        method,
        headers,
        ...(opts.raw
          ? { body: opts.raw.body }
          : opts.body !== undefined
            ? { body: JSON.stringify(opts.body) }
            : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") throw caught;
      throw new AgentIdError(
        0,
        "network",
        "Can't reach Agent ID. Check your connection and try again.",
      );
    }
    if (!response.ok) throw await errorFromResponse(response);
    if (opts.blob) return (await response.blob()) as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  const id = encodeURIComponent;

  return {
    request,

    // Deployment and account
    config: () => request<PublicConfig>("/v1/config"),
    account: () => request<Account>("/v1/account"),
    acceptTerms: (version: string) =>
      request<{ terms: { accepted: boolean; version: string; acceptedAt: string } }>(
        "/v1/account/terms",
        { body: { version } },
      ),
    verifyPerson: (input: { legalName?: string; country?: string; consent?: boolean }) =>
      request<{ person: Person; url?: string }>("/v1/account/verification", {
        body: { kind: "person", ...input },
      }),
    verifyBusiness: (input: {
      organizationId: string;
      legalName: string;
      // Bridge's own page asks for the registration where it checks businesses.
      registrationNumber?: string;
      vatNumber?: string;
      country: string;
      website?: string;
      representativeRole?: string;
      attestation?: boolean;
    }) =>
      request<{ business: Business; url?: string }>("/v1/account/verification", {
        body: { kind: "business", ...input },
      }),
    // The business's registration certificate (PDF or photo, at most 10 MB).
    uploadBusinessDocument: (organizationId: string, file: File) =>
      request<{ business: Business }>("/v1/account/verification/document", {
        query: { organization: organizationId },
        raw: {
          body: file,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Filename": encodeURIComponent(file.name),
          },
        },
      }),

    // Agents
    listAgents: (status?: "all") =>
      request<{ agents: Agent[] }>("/v1/agents", { query: { status } }),
    createAgent: (input: {
      name: string;
      runtime?: Runtime;
      origin?: { app: string; detail?: string | null };
      organizationId?: string | null;
      desktopAgentId?: string;
    }) => request<CreatedAgent>("/v1/agents", { body: input }),
    getAgent: (agentId: string) => request<AgentDetail>(`/v1/agents/${id(agentId)}`),
    updateAgent: (
      agentId: string,
      patch: {
        name?: string;
        runtime?: Runtime;
        status?: "active" | "suspended";
        organizationId?: string | null;
        desktopAgentId?: string | null;
        origin?: { app: string; detail?: string | null };
        mascot?: Mascot;
      },
    ) => request<{ agent: Agent }>(`/v1/agents/${id(agentId)}`, { method: "PATCH", body: patch }),
    cardApplication: (agentId: string) =>
      request<{ application: CardApplication | null }>(
        `/v1/agents/${id(agentId)}/card-application`,
      ),
    applyForCard: (
      agentId: string,
      input: { useCase: string; monthlySpend: number; country: string },
    ) =>
      request<{ application: CardApplication }>(`/v1/agents/${id(agentId)}/card-application`, {
        body: input,
      }),
    phoneApplication: (agentId: string) =>
      request<{ application: PhoneApplication | null }>(
        `/v1/agents/${id(agentId)}/phone-application`,
      ),
    applyForPhone: (
      agentId: string,
      input: { useCase: string; uses: PhoneUse[]; country: string },
    ) =>
      request<{ application: PhoneApplication }>(`/v1/agents/${id(agentId)}/phone-application`, {
        body: input,
      }),
    revokeAgent: (agentId: string) =>
      request<{ agent: Agent }>(`/v1/agents/${id(agentId)}`, { method: "DELETE" }),
    createAgentKey: (agentId: string, name?: string) =>
      request<CreatedKey>(`/v1/agents/${id(agentId)}/keys`, { body: name ? { name } : {} }),
    revokeAgentKey: (agentId: string, keyId: string) =>
      request<{ revoked: boolean }>(`/v1/agents/${id(agentId)}/keys/${id(keyId)}`, {
        method: "DELETE",
      }),

    // Resources
    provision: (agentId: string, input: ProvisionInput) =>
      request<{ resource: Resource }>(`/v1/agents/${id(agentId)}/resources`, { body: input }),
    updateResource: (
      agentId: string,
      kind: Kind,
      patch: {
        settings?: ResourceSettings | Record<string, unknown>;
        status?: "active" | "suspended";
      },
    ) =>
      request<{ resource: Resource }>(`/v1/agents/${id(agentId)}/resources/${kind}`, {
        method: "PATCH",
        body: patch,
      }),
    removeResource: (agentId: string, kind: Kind) =>
      request<{ released: boolean }>(`/v1/agents/${id(agentId)}/resources/${kind}`, {
        method: "DELETE",
      }),
    addMoneyInfo: (agentId: string) =>
      request<AddMoneyInfo>(`/v1/agents/${id(agentId)}/wallet/add-money`),
    // Buying USDC by card (MoonPay, or Stripe's crypto onramp), only where offered.
    buyWithCard: (agentId: string, amount?: string) =>
      request<CardOnrampSession>(`/v1/agents/${id(agentId)}/wallet/add-money`, {
        body: amount ? { amount } : {},
      }),
    // The owner taking money out of a live wallet: to their own address on
    // Base, or to one of their bank accounts.
    withdraw: (
      agentId: string,
      input:
        | { to: string; value: string; asset?: "usdc" | "usdt"; remember?: boolean }
        | { bankAccount: string; value: string },
    ) => request<WithdrawResult>(`/v1/agents/${id(agentId)}/wallet/withdraw`, { body: input }),
    // This wallet's own bank details for deposits in a currency.
    bankDeposit: (agentId: string, currency: BankCurrency) =>
      request<{ deposit: BankDeposit }>(`/v1/agents/${id(agentId)}/wallet/bank-deposit`, {
        body: { currency },
      }),
    // Adding money by SEPA: one transfer of a set amount (cents), to this wallet.
    bankPayins: (agentId: string) =>
      request<{ payins: BankPayin[] }>(`/v1/agents/${id(agentId)}/wallet/bank-payins`),
    startBankPayin: (agentId: string, amount: number) =>
      request<{ payin: BankPayin }>(`/v1/agents/${id(agentId)}/wallet/bank-payins`, {
        body: { amount },
      }),
    cancelBankPayin: (agentId: string, payinId: string) =>
      request<{ canceled: boolean }>(
        `/v1/agents/${id(agentId)}/wallet/bank-payins/${id(payinId)}`,
        { method: "DELETE" },
      ),
    bank: () => request<BankStatus>("/v1/account/bank"),
    startBankVerification: () => request<BankStatus>("/v1/account/bank/verify", { body: {} }),
    addBankAccount: (input: NewBankAccount) =>
      request<{ account: BankAccount }>("/v1/account/bank/accounts", { body: input }),
    removeBankAccount: (accountId: string) =>
      request<{ removed: boolean }>(`/v1/account/bank/accounts/${id(accountId)}`, {
        method: "DELETE",
      }),
    addTestFunds: (agentId: string, amount: number) =>
      request<{ balance: Money }>(`/v1/agents/${id(agentId)}/wallet/test-funds`, {
        body: { amount },
      }),
    events: (
      agentId: string,
      input: { kind?: EventKind[]; direction?: "in" | "out"; before?: string; limit?: number },
    ) =>
      request<EventPage>(`/v1/agents/${id(agentId)}/events`, {
        query: {
          kind: input.kind?.join(","),
          direction: input.direction,
          before: input.before,
          limit: input.limit,
        },
      }),
    contacts: (agentId: string) =>
      request<{ contacts: Contact[] }>(`/v1/agents/${id(agentId)}/contacts`),

    // Approvals, audit log, owner keys
    approvals: (status?: "all") =>
      request<{ approvals: Approval[] }>("/v1/approvals", { query: { status } }),
    decideApproval: (approvalId: string, decision: "approve" | "deny") =>
      request<{ decision?: string; status: string; message?: string }>(
        `/v1/approvals/${id(approvalId)}`,
        { body: { decision } },
      ),
    audit: (input: { agent?: string; limit?: number } = {}) =>
      request<{ entries: AuditEntry[] }>("/v1/audit", {
        query: { agent: input.agent, limit: input.limit },
      }),
    ownerKeys: () => request<{ keys: ApiKey[] }>("/v1/keys"),
    createOwnerKey: (name?: string) =>
      request<CreatedKey>("/v1/keys", { body: name ? { name } : {} }),
    revokeOwnerKey: (keyId: string) =>
      request<{ revoked: boolean }>(`/v1/keys/${id(keyId)}`, { method: "DELETE" }),

    // Companies (relying parties)
    relyingParties: () => request<{ relyingParties: RelyingParty[] }>("/v1/relying-parties"),
    createRelyingParty: (input: {
      name: string;
      audience: string;
      organizationId?: string;
      policy?: RelyingPartyPolicy;
    }) =>
      request<{ relyingParty: RelyingParty; secret: string }>("/v1/relying-parties", {
        body: input,
      }),
    updateRelyingParty: (
      rpId: string,
      patch: {
        name?: string;
        policy?: { require?: PolicyRequire; organizations?: string[] | null };
      },
    ) =>
      request<{ relyingParty: RelyingParty }>(`/v1/relying-parties/${id(rpId)}`, {
        method: "PATCH",
        body: patch,
      }),
    revokeRelyingParty: (rpId: string) =>
      request<{ revoked: boolean }>(`/v1/relying-parties/${id(rpId)}`, { method: "DELETE" }),

    // Operators (Agent ID staff)
    adminStatus: () => request<AdminStatus>("/v1/admin/status"),
    adminSetup: () => request<AdminSetup>("/v1/admin/setup", { body: {} }),

    // Reviews (Agent ID reviewers only)
    reviews: () => request<{ people: PersonReview[]; businesses: BusinessReview[] }>("/v1/reviews"),
    reviewDocument: (organizationId: string) =>
      request<Blob>(`/v1/reviews/business/${id(organizationId)}/document`, { blob: true }),
    decideReview: (
      kind: "person" | "business",
      reviewId: string,
      decision: "approve" | "reject",
      note?: string,
    ) =>
      request<{ person?: Person; business?: Business }>(`/v1/reviews/${kind}/${id(reviewId)}`, {
        body: { decision, ...(note ? { note } : {}) },
      }),

    // The owner acting as one of their agents.
    asAgent: (agent: string) => ({
      sendMail: (input: {
        to?: string;
        cc?: string;
        subject?: string;
        text: string;
        replyTo?: string;
        attachments?: string[];
      }) => request<{ message: AgentEvent; note?: string }>("/v1/me/mail", { agent, body: input }),
      mail: (input: {
        folder: MailFolder;
        q?: string;
        unread?: boolean;
        before?: string;
        limit?: number;
      }) =>
        request<MailPage>("/v1/me/mail", {
          agent,
          query: {
            folder: input.folder,
            q: input.q,
            unread: input.unread ? 1 : undefined,
            before: input.before,
            limit: input.limit,
          },
        }),
      mailCounts: () => request<MailCounts>("/v1/me/mail/counts", { agent }),
      readMail: (messageId: string) =>
        request<{ message: MailMessage }>(`/v1/me/mail/${id(messageId)}`, { agent }),
      moveMail: (messageId: string, folder: "trash" | "inbox") =>
        request<{ message?: MailMessage }>(`/v1/me/mail/${id(messageId)}/move`, {
          agent,
          body: { folder },
        }),
      markRead: (messageId: string, read: boolean) =>
        request<{ message?: MailMessage }>(`/v1/me/mail/${id(messageId)}/read`, {
          agent,
          body: { read },
        }),
      deleteMail: (messageId: string) =>
        request<{ deleted: boolean }>(`/v1/me/mail/${id(messageId)}`, {
          agent,
          method: "DELETE",
        }),
      uploadFile: (file: File) =>
        request<{ file: FileRef }>("/v1/me/files", {
          agent,
          raw: {
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-Filename": encodeURIComponent(file.name),
            },
          },
        }),
      downloadFile: (fileId: string) =>
        request<Blob>(`/v1/me/files/${id(fileId)}`, { agent, blob: true }),
      sendSms: (input: { to: string; text: string }) =>
        request<{ message: AgentEvent }>("/v1/me/sms", { agent, body: input }),
      placeCall: (input: { to: string; say: string }) =>
        request<{ call: AgentEvent }>("/v1/me/calls", { agent, body: input }),
      saveContact: (input: {
        id?: string;
        name?: string;
        email?: string;
        phone?: string;
        wallet?: string;
        note?: string;
      }) =>
        input.id
          ? request<{ contact: Contact }>(`/v1/me/contacts/${id(input.id)}`, {
              agent,
              method: "PATCH",
              body: input,
            })
          : request<{ contact: Contact }>("/v1/me/contacts", { agent, body: input }),
      deleteContact: (contactId: string) =>
        request<{ deleted: boolean }>(`/v1/me/contacts/${id(contactId)}`, {
          agent,
          method: "DELETE",
        }),
      wallet: () => request<{ wallet: WalletSummary }>("/v1/me/wallet", { agent }),
      sendMoney: (input: { to: string; value: string; memo?: string; asset?: string }) =>
        request<TransferResult>("/v1/me/wallet/transfers", { agent, body: input }),
      card: () => request<{ card: CardSummary }>("/v1/me/card", { agent }),
      testCharge: (input: { value: string; merchant?: string; category?: string }) =>
        request<TestChargeResult>("/v1/me/card/test-charge", { agent, body: input }),
      machine: () => request<{ machine: MachineSummary }>("/v1/me/vm", { agent }),
      startMachine: () =>
        request<{ machine: { state: string; note?: string } }>("/v1/me/vm/start", {
          agent,
          body: {},
        }),
      stopMachine: () =>
        request<{ machine: { state: string } }>("/v1/me/vm/stop", { agent, body: {} }),
      runCommand: (input: { command: string; cwd?: string; timeoutSeconds?: number }) =>
        request<CommandResult>("/v1/me/vm/exec", { agent, body: input }),
      machineFiles: (path?: string) =>
        request<VmListing>("/v1/me/vm/files", { agent, query: { path } }),
      signingKeys: () =>
        request<{ keys: SigningKey[]; principal: string }>("/v1/me/signing-keys", { agent }),
      addSigningKey: (input: { publicKey: string; name?: string }) =>
        request<{ key: SigningKey; principal: string }>("/v1/me/signing-keys", {
          agent,
          body: input,
        }),
      removeSigningKey: (keyId: string) =>
        request<{ removed: boolean }>(`/v1/me/signing-keys/${id(keyId)}`, {
          agent,
          method: "DELETE",
        }),
    }),
  };
}

export type AgentIdClient = ReturnType<typeof createAgentIdClient>;

// What to show a person for any error.
export function errorMessage(error: unknown): string {
  if (error instanceof AgentIdError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
