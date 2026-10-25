// What a chat asks the user to fill in (Approval.jsx): a form an app sends
// (MCP elicitation), the agent's questions (Codex's request_user_input) and a
// page an app asks the user to open. Which answers are required, what's
// missing, and the typed answer that goes back.

const text = value => typeof value === "string" ? value.trim() : "";
const count = value => Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : undefined;
const number = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;

// "first_name" and "startDate" read "First name" and "Start date".
export function labelFrom(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : String(key);
}

// A choice's options: oneOf/anyOf with const and title, or enum with the
// older enumNames for its labels.
function optionsOf(spec) {
  const list = Array.isArray(spec.oneOf) ? spec.oneOf : Array.isArray(spec.anyOf) ? spec.anyOf : null;
  const names = Array.isArray(spec.enumNames) ? spec.enumNames : [];
  const options = list
    ? list.filter(option => option && typeof option.const === "string").map(option => ({ value: option.const, label: text(option.title) || option.const }))
    : Array.isArray(spec.enum) ? spec.enum.map((value, index) => ({ value, label: text(names[index]) || value })).filter(option => typeof option.value === "string") : [];
  const seen = new Set();
  return options.filter(option => !seen.has(option.value) && seen.add(option.value));
}

const FORMATS = { email: "email", uri: "url", date: "date", "date-time": "datetime" };

function fieldFrom(key, spec, required) {
  if (!spec || typeof spec !== "object") return null;
  const base = { key, label: text(spec.title) || labelFrom(key), description: text(spec.description), required };
  if (spec.type === "array") {
    const options = optionsOf(spec.items || {});
    if (!options.length) return null;
    const chosen = Array.isArray(spec.default) ? spec.default.filter(value => options.some(option => option.value === value)) : [];
    return { ...base, kind: "choices", options, minItems: count(spec.minItems), maxItems: count(spec.maxItems), default: chosen };
  }
  if (spec.type === "string" || (spec.type === undefined && (spec.enum || spec.oneOf))) {
    const options = optionsOf(spec);
    if (options.length) return { ...base, kind: "choice", options, default: options.some(option => option.value === spec.default) ? spec.default : "" };
    if (spec.type !== "string") return null;
    return { ...base, kind: FORMATS[spec.format] || "text", minLength: count(spec.minLength), maxLength: count(spec.maxLength), default: typeof spec.default === "string" ? spec.default : "" };
  }
  if (spec.type === "number" || spec.type === "integer") {
    return { ...base, kind: spec.type, minimum: number(spec.minimum), maximum: number(spec.maximum), default: number(spec.default) === undefined ? "" : String(spec.default) };
  }
  if (spec.type === "boolean") return { ...base, kind: "boolean", default: spec.default === true };
  return null;
}

// A form's fields from its schema: flat text, number, yes/no and choice
// properties. A field that can't be shown is left out when it's optional;
// when it's required the form is unsupported, as it could never be sent.
// Codex passes the properties on sorted by name, so the required fields come
// first in the order of the schema's required list (a list keeps the app's
// order), and the optional ones after them.
export function formFields(schema) {
  const properties = schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const order = Array.isArray(schema?.required) ? [...new Set(schema.required.filter(key => typeof key === "string"))] : [];
  const required = new Set(order);
  const fields = [];
  let unsupported = order.some(key => !(key in properties));
  for (const [key, spec] of Object.entries(properties)) {
    const field = fieldFrom(key, spec, required.has(key));
    if (field) fields.push(field);
    else if (required.has(key)) unsupported = true;
  }
  const rank = field => field.required ? order.indexOf(field.key) : order.length;
  return { fields: fields.map((field, index) => ({ field, index })).sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index).map(item => item.field), unsupported };
}

export const initialValues = fields => Object.fromEntries(fields.map(field => [field.key, field.default]));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isWebAddress = value => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };
const plural = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;
const range = (minimum, maximum) => minimum !== undefined && maximum !== undefined ? `Enter a number from ${minimum} to ${maximum}.`
  : minimum !== undefined ? `Enter ${minimum} or more.` : `Enter ${maximum} or less.`;

// Why a field's value can't be sent, or null.
export function fieldError(field, value) {
  switch (field.kind) {
    case "boolean": return null;
    case "choices": {
      const chosen = Array.isArray(value) ? value.length : 0;
      if (!chosen) return field.required ? (field.minItems > 1 ? `Choose at least ${field.minItems}.` : "Choose at least one.") : null;
      if (field.minItems !== undefined && chosen < field.minItems) return `Choose at least ${field.minItems}.`;
      if (field.maxItems !== undefined && chosen > field.maxItems) return `Choose up to ${field.maxItems}.`;
      return null;
    }
    case "choice": return !value && field.required ? "Choose one." : null;
    case "number": case "integer": {
      const raw = String(value ?? "").trim();
      if (!raw) return field.required ? "Required." : null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return "Enter a number.";
      if (field.kind === "integer" && !Number.isInteger(parsed)) return "Enter a whole number.";
      if ((field.minimum !== undefined && parsed < field.minimum) || (field.maximum !== undefined && parsed > field.maximum)) return range(field.minimum, field.maximum);
      return null;
    }
    default: {
      const raw = String(value ?? "").trim();
      if (!raw) return field.required ? "Required." : null;
      if (field.kind === "email" && !EMAIL.test(raw)) return "Enter an email address.";
      if (field.kind === "url" && !isWebAddress(raw)) return "Enter a web address, such as https://example.com.";
      if (field.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Enter a date.";
      if (field.kind === "datetime" && Number.isNaN(new Date(raw).getTime())) return "Enter a date and time.";
      if (field.minLength !== undefined && raw.length < field.minLength) return `Enter at least ${plural(field.minLength, "character")}.`;
      if (field.maxLength !== undefined && raw.length > field.maxLength) return `Enter at most ${plural(field.maxLength, "character")}.`;
      return null;
    }
  }
}

// Each field that can't be sent yet, by key, in the form's order.
export function formErrors(fields, values) {
  const errors = {};
  for (const field of fields) {
    const error = fieldError(field, values[field.key]);
    if (error) errors[field.key] = error;
  }
  return errors;
}

// The answer as the schema types it. Empty optional fields are left out.
export function formContent(fields, values) {
  const content = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.kind === "boolean") { content[field.key] = value === true; continue; }
    if (field.kind === "choices") { if (value?.length || field.required) content[field.key] = [...(value || [])]; continue; }
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    content[field.key] = field.kind === "number" || field.kind === "integer" ? Number(raw)
      : field.kind === "datetime" ? new Date(raw).toISOString()
        : raw;
  }
  return content;
}

// The agent's questions: each needs an answer, an option or (when the
// question takes one, or has no options) the user's own words.
export function questionErrors(questions, answers) {
  const errors = {};
  for (const question of questions) {
    if (String(answers[question.id] ?? "").trim()) continue;
    errors[question.id] = !question.options?.length ? "Type an answer." : question.isOther ? "Choose an answer or type your own." : "Choose an answer.";
  }
  return errors;
}

// Secrets are sent exactly as typed; other answers without surrounding spaces.
export const questionAnswers = (questions, answers) => Object.fromEntries(questions.map(question => {
  const answer = String(answers[question.id] ?? "");
  return [question.id, { answers: [question.isSecret ? answer : answer.trim()] }];
}));

// A page an app asks the user to open: HTTPS, or HTTP on this computer (an
// app in development). Never an address with a user name or password in it.
export function pageLink(url) {
  try {
    const address = new URL(String(url));
    if (address.username || address.password) return null;
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(address.hostname);
    if (address.protocol === "https:" || (address.protocol === "http:" && local)) return { href: address.href, host: address.host };
  } catch {}
  return null;
}
