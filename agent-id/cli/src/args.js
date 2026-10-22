// Command-line arguments: positionals, --flags (with a value unless they are
// switches), --flag=value, and everything after `--` kept as is.
import { UsageError } from './errors.js';

const SWITCHES = new Set(['json', 'help', 'live', 'print', 'global', 'unread', 'all', 'yes', 'version', 'local', 'project', 'quiet', 'here', 'test', 'memory', 'dry-run']);
const REPEATABLE = new Set(['attach']);

export function parseArgs(argv) {
  const positionals = [], flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (arg === '-h') { flags.help = true; continue; }
    if (arg === '-v' || arg === '-V') { flags.version = true; continue; }
    if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).toLowerCase();
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else if (SWITCHES.has(name)) value = true;
      else if (name.startsWith('no-') && SWITCHES.has(name.slice(3))) { flags[name.slice(3)] = false; continue; }
      else {
        value = argv[i + 1];
        if (value === undefined) throw new UsageError(`--${name} needs a value.`);
        i++;
      }
      if (SWITCHES.has(name) && typeof value === 'string') value = !/^(false|0|no)$/i.test(value);
      // A repeated value flag (--attach a --attach b) collects a list.
      if (REPEATABLE.has(name) && typeof flags[name] === 'string') flags[name] = [flags[name], value];
      else if (REPEATABLE.has(name) && Array.isArray(flags[name])) flags[name].push(value);
      else flags[name] = value;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags, rest };
}

// Dollars as typed ("50", "12.5", "$12.50") to cents.
export function dollarsToCents(value, name) {
  const raw = String(value ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) throw new UsageError(`${name} must be an amount in dollars, like 50 or 12.50.`);
  const [whole, fraction = ''] = raw.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// The same amount as the API takes it in `value` ("12.50").
export function dollarsString(value, name) {
  const cents = dollarsToCents(value, name);
  if (cents <= 0) throw new UsageError(`${name} must be more than zero.`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export const centsToDollars = cents => cents === null || cents === undefined ? '—' : `$${(Number(cents) / 100).toFixed(2)}`;
