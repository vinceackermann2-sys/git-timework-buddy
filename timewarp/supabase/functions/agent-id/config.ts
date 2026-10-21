// What this deployment offers, from its secrets. Nothing real is used until a
// kind is listed in AGENT_ID_LIVE: before that, every resource is a test one
// that only works inside Agent ID, so a deploy never starts spending money.

export type Kind = 'mail' | 'phone' | 'wallet' | 'card' | 'vm';
export const KINDS: Kind[] = ['mail', 'phone', 'wallet', 'card', 'vm'];
export type Env = (name: string) => string;

const list = (value: string) => value.split(/[,\s]+/).map(item => item.trim().toLowerCase()).filter(Boolean);

export function loadConfig(env: Env) {
  const get = (name: string) => (env(name) || '').trim();
  const supabaseUrl = get('SUPABASE_URL').replace(/\/+$/, '');
  const publicUrl = (get('AGENT_ID_PUBLIC_URL') || (supabaseUrl ? `${supabaseUrl}/functions/v1/agent-id` : 'http://localhost/agent-id')).replace(/\/+$/, '');
  const siteUrl = (get('AGENT_ID_SITE_URL') || get('TIMEWARP_SITE_URL') || 'https://timewarpdev.com').replace(/\/+$/, '');
  const mailDomain = (get('AGENT_ID_MAIL_DOMAIN') || get('TIMEWARP_AGENT_MAIL_DOMAIN') || 'agents.timewarpdev.com').toLowerCase();
  const live = new Set(list(get('AGENT_ID_LIVE')));
  const required = new Set(list(get('AGENT_ID_REQUIRE_VERIFICATION') || 'wallet,card'));
  const paid = new Set(list(get('AGENT_ID_PAID_PLAN_KINDS') || 'phone,card'));

  // Each kind's live provider, and whether its secrets are present.
  // Phone numbers from Telnyx or Twilio: AGENT_ID_PHONE_PROVIDER, else
  // Telnyx whenever its key is set.
  const phoneProvider = (get('AGENT_ID_PHONE_PROVIDER').toLowerCase() || (get('TELNYX_API_KEY') ? 'telnyx' : 'twilio')) === 'telnyx' ? 'telnyx' : 'twilio';
  const providers = {
    mail: { provider: 'resend', configured: !!get('RESEND_API_KEY') && !!mailDomain },
    phone: phoneProvider === 'telnyx'
      ? { provider: 'telnyx', configured: !!get('TELNYX_API_KEY') && !!get('TELNYX_PUBLIC_KEY') }
      : { provider: 'twilio', configured: !!get('TWILIO_ACCOUNT_SID') && !!get('TWILIO_AUTH_TOKEN') },
    wallet: { provider: 'privy', configured: !!get('PRIVY_APP_ID') && !!get('PRIVY_APP_SECRET') },
    card: { provider: 'stripe_issuing', configured: !!get('STRIPE_SECRET_KEY') },
    vm: { provider: 'azure_sandbox', configured: ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SUBSCRIPTION_ID', 'AZURE_SANDBOX_RESOURCE_GROUP', 'AZURE_SANDBOX_GROUP'].every(name => !!get(name)) },
  } as Record<Kind, { provider: string; configured: boolean }>;

  const kyc = get('AGENT_ID_KYC').toLowerCase();
  const kyb = get('AGENT_ID_KYB').toLowerCase();
  return {
    env: get,
    supabaseUrl,
    publicUrl,
    siteUrl,
    issuer: get('AGENT_ID_ISSUER') || `${siteUrl}/agent-id`,
    mailDomain,
    testMailDomain: get('AGENT_ID_TEST_MAIL_DOMAIN') || 'agents.timewarp.test',
    principalDomain: get('AGENT_ID_PRINCIPAL_DOMAIN') || mailDomain,
    webhookSecret: get('AGENT_ID_WEBHOOK_SECRET'),
    signingKey: get('AGENT_ID_SIGNING_KEY'),
    previousSigningKeys: get('AGENT_ID_PREVIOUS_PUBLIC_KEYS'),
    providers,
    // Live only when listed and configured.
    isLive: (kind: Kind) => live.has(kind) && providers[kind].configured,
    liveListed: (kind: Kind) => live.has(kind),
    // Kinds whose live resources need a verified owner; 'agent' means even
    // creating an agent does (the future default).
    verificationRequired: (what: Kind | 'agent') => required.has(what) || required.has('all'),
    paidPlanRequired: (kind: Kind) => paid.has(kind),
    kycProvider: kyc === 'stripe_identity' || kyc === 'test' ? kyc : 'manual',
    kybProvider: kyb === 'test' ? 'test' : 'manual',
    reviewers: new Set(list(get('AGENT_ID_REVIEWERS'))),
    maxAgents: Math.max(1, Math.min(1000, Number(get('AGENT_ID_MAX_AGENTS')) || 25)),
    // Privy's chain for live wallets: Base, or Base Sepolia (testnet) for trials.
    walletChain: get('AGENT_ID_WALLET_CHAIN') === 'base_sepolia' ? 'base_sepolia' : 'base',
    // Test resources (that only work inside Agent ID) are for development:
    // production sets AGENT_ID_ALLOW_TEST=false, so everything given is real.
    testMode: get('AGENT_ID_ALLOW_TEST') !== 'false',
    // Accounts accept the Agent ID Terms before creating agents.
    termsRequired: get('AGENT_ID_REQUIRE_TERMS') !== 'false',
    termsVersion: get('AGENT_ID_TERMS_VERSION') || '2026-10-20',
    // Live wallet transfers are screened against sanctions lists when set.
    sanctionsKey: get('CHAINALYSIS_API_KEY'),
    // Cards are an early-access application until a card provider is chosen;
    // AGENT_ID_CARDS=issuing turns Stripe Issuing cards back on.
    cardsWaitlist: get('AGENT_ID_CARDS') !== 'issuing',
    // Live phone numbers are an application until they're switched on and set
    // up; AGENT_ID_PHONES=waitlist keeps the application anywhere. Numbers an
    // agent already has stay.
    phonesWaitlist: get('AGENT_ID_PHONES') === 'waitlist' || (get('AGENT_ID_ALLOW_TEST') === 'false' && !(live.has('phone') && providers.phone.configured)),
    passportSeconds: Math.max(60, Math.min(3600, Number(get('AGENT_ID_PASSPORT_SECONDS')) || 300)),
    // What a new Agent ID comes with (provisioning.ts): 'none' for nothing.
    autoGive: get('AGENT_ID_AUTO_GIVE') === 'none' ? [] as string[] : list(get('AGENT_ID_AUTO_GIVE') || 'mail,wallet'),
    autoGivePaid: get('AGENT_ID_AUTO_GIVE_PAID') === 'none' ? [] as string[] : list(get('AGENT_ID_AUTO_GIVE_PAID') || 'phone,vm'),
    // Registering its own webhooks on first use (admin.ts); tests turn it off.
    autoSetup: get('AGENT_ID_AUTO_SETUP') !== 'false',
    // Bank transfers in and out of live wallets through Bridge, once its key
    // is set; AGENT_ID_BANK=off hides them.
    // Euros (SEPA) need Bridge to open them for the account; AGENT_ID_BANK_CURRENCIES=usd until then.
    bank: {
      provider: 'bridge', configured: !!get('BRIDGE_API_KEY'), on: get('AGENT_ID_BANK') !== 'off',
      currencies: (['usd', 'eur'] as const).filter(currency => list(get('AGENT_ID_BANK_CURRENCIES') || 'usd,eur').includes(currency)),
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;

// Bank transfers need Bridge and live wallets on Base mainnet.
export const bankAvailable = (config: Config) => config.bank.on && config.bank.configured && config.isLive('wallet') && config.walletChain === 'base';

// What the dashboard, CLI and agents are told about this deployment.
export function publicConfig(config: Config) {
  return {
    issuer: config.issuer,
    api: config.publicUrl,
    mcp: `${config.publicUrl}/mcp`,
    jwks: `${config.publicUrl}/.well-known/jwks.json`,
    mailDomain: config.mailDomain,
    resources: Object.fromEntries(Object.entries(config.providers).map(([kind, value]) => [kind, {
      live: config.isLive(kind as Kind),
      provider: config.isLive(kind as Kind) ? value.provider : 'test',
      // Why it isn't live: not switched on yet, or switched on without its provider's secrets.
      ...(config.isLive(kind as Kind) ? {} : { unavailable: config.liveListed(kind as Kind) ? 'not_configured' : 'not_enabled' }),
      ...((kind === 'card' && config.cardsWaitlist) || (kind === 'phone' && config.phonesWaitlist) ? { waitlist: true } : {}),
      verificationRequired: config.verificationRequired(kind as Kind),
      paidPlanRequired: config.paidPlanRequired(kind as Kind),
    }])),
    verification: { person: config.kycProvider, business: config.kybProvider, requiredToCreateAgents: config.verificationRequired('agent') },
    testMode: config.testMode,
    legal: { termsVersion: config.termsVersion, termsUrl: `${config.siteUrl}/legal/agent-id-terms`, privacyUrl: `${config.siteUrl}/legal/privacy-policy` },
    passports: { available: !!config.signingKey, lifetimeSeconds: config.passportSeconds },
    bank: { available: bankAvailable(config) },
  };
}
