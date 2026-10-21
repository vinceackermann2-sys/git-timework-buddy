// Plain-text output: aligned tables, money and dates.

export function table(rows, columns) {
  if (!rows.length) return '';
  const cells = rows.map(row => columns.map(([title, get]) => {
    const value = get(row);
    return value === undefined || value === null || value === '' ? (title ? '-' : '') : String(value).replace(/\s+/g, ' ');
  }));
  const widths = columns.map(([title], i) => Math.max(title.length, ...cells.map(r => r[i].length)));
  const line = values => values.map((v, i) => i === values.length - 1 ? v : v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns.map(([title]) => title)), ...cells.map(line)].join('\n');
}

// "$12.34 USD" (other currencies: "12.34 EUR").
export const usd = (amount, currency = 'USD') => {
  const value = (Number(amount) / 100).toFixed(2);
  return !currency || String(currency).toUpperCase() === 'USD' ? `$${value} USD` : `${value} ${String(currency).toUpperCase()}`;
};
export const money = value => value && typeof value === 'object' ? usd(value.amount, value.currency) : value === null || value === undefined ? '-' : String(value);
export const cents = value => value === null || value === undefined ? 'none' : `$${(Number(value) / 100).toFixed(2)}`;

export function when(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

export const clip = (text, length) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
};

// "key: value" lines, skipping empty values.
export const fields = pairs => pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');

const LIMIT_NAMES = { perTransfer: 'per transfer', perTransaction: 'per payment', daily: 'per day', monthly: 'per month', approvalAbove: 'owner approves above' };
export function limits(settings = {}) {
  const parts = [];
  for (const [key, label] of Object.entries(LIMIT_NAMES)) if (settings[key] !== undefined) parts.push(`${label} ${cents(settings[key])}`);
  if (Array.isArray(settings.blockedCategories) && settings.blockedCategories.length) parts.push(`blocked: ${settings.blockedCategories.join(', ')}`);
  if (Array.isArray(settings.allowedCategories) && settings.allowedCategories.length) parts.push(`only: ${settings.allowedCategories.join(', ')}`);
  return parts.join(', ') || 'no limits';
}
