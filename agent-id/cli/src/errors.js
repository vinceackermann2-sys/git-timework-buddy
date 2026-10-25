// What can go wrong, and what the user should do about it.

// A problem with how the command was typed (exit code 2).
export class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError'; }
}

// A problem the user can fix, explained (exit code 1).
export class CliError extends Error {
  constructor(message, { hint, code } = {}) { super(message); this.name = 'CliError'; this.hint = hint; this.code = code; }
}

// An error answer from Agent ID: { error: { code, message } }.
export class ApiError extends Error {
  constructor(status, code, message, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const HINTS = {
  owner: {
    unauthenticated: 'Run `timewarp-id login --owner-key two_…` with a key from the Agent ID dashboard.',
    invalid_key: 'Your sign-in here no longer works: the owner key was revoked or is wrong. Create a new one on the Agent ID dashboard and run `timewarp-id login --owner-key two_…`.',
  },
  agent: {
    unauthenticated: 'This agent has no working key here. Get a new one with `timewarp-id agents key <agent>`.',
    invalid_key: 'This agent\'s key here no longer works (it was revoked or replaced). Get a new one with `timewarp-id agents key <agent>`.',
    agent_revoked: 'This agent was revoked by its owner; create a new agent with `timewarp-id agents create <name>`.',
    agent_suspended: 'Its owner can resume it with `timewarp-id agents resume <agent>`.',
  },
  any: {
    verification_required: 'This needs your identity verified, once: do it on the Agent ID dashboard, then try again.',
    terms_required: 'Run `timewarp-id terms` to read and accept Agent ID\'s terms of service, then try again.',
    provider_unavailable: 'This Agent ID can\'t give out real ones of these yet; add --test for a test one while developing.',
    plan_required: 'This needs a paid Timewarp plan.',
    live_unavailable: 'This Agent ID can\'t give out real ones of these yet; add --test for a test one while developing.',
    session_required: 'Create owner keys on the Agent ID dashboard.',
    no_mail: 'Give it one with `timewarp-id give mail --agent <agent>`.',
    no_phone: 'Apply for a phone number for it on the Agent ID dashboard.',
    no_wallet: 'Give it one with `timewarp-id give wallet --agent <agent>`.',
    no_card: 'Apply for one with `timewarp-id card apply --agent <agent> --use-case "…" --monthly 200 --country US`.',
    machine_not_ready: 'Its computer is starting for the first time; try again in a minute.',
    test_machine: 'This is a test machine. Give it a real one: `timewarp-id take vm --agent <agent>`, then `timewarp-id give vm --agent <agent>`.',
  },
};

export function hintFor(error, as) {
  if (error instanceof CliError) return error.hint;
  if (!(error instanceof ApiError)) return undefined;
  return HINTS[as]?.[error.code] || HINTS.any[error.code];
}
