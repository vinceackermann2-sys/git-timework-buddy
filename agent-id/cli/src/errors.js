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
    invalid_key: 'Your owner key was revoked or is wrong. Create a new one on the Agent ID dashboard and run `timewarp-id login --owner-key two_…`.',
  },
  agent: {
    unauthenticated: 'This agent has no working key here. Get a new one with `timewarp-id agents key <agent>`.',
    invalid_key: 'This agent\'s key was revoked or is wrong. Get a new one with `timewarp-id agents key <agent>`.',
    agent_revoked: 'This agent was revoked by its owner; create a new agent with `timewarp-id agents create <name>`.',
    agent_suspended: 'Its owner can resume it with `timewarp-id agents resume <agent>`.',
  },
  any: {
    verification_required: 'Verify your identity on the Agent ID dashboard first.',
    plan_required: 'This needs a paid Timewarp plan.',
    live_unavailable: 'Leave out --live to use a test one for now.',
    session_required: 'Create owner keys on the Agent ID dashboard.',
    no_mail: 'Give it one with `timewarp-id give mail --agent <agent>`.',
    no_phone: 'Give it one with `timewarp-id give phone --agent <agent>`.',
    no_wallet: 'Give it one with `timewarp-id give wallet --agent <agent>`.',
    no_card: 'Give it one with `timewarp-id give card --agent <agent>`.',
    no_vm: 'Give it one with `timewarp-id give vm --agent <agent>`.',
    test_machine: 'Give it a live machine: `timewarp-id take vm --agent <agent>` then `timewarp-id give vm --live --agent <agent>`.',
  },
};

export function hintFor(error, as) {
  if (error instanceof CliError) return error.hint;
  if (!(error instanceof ApiError)) return undefined;
  return HINTS[as]?.[error.code] || HINTS.any[error.code];
}
