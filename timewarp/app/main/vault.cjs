"use strict";
// The vault: sign-ins, payment cards and secrets kept on this device,
// encrypted with the operating system's key store (Electron safeStorage).
// Secrets never go to the cloud or to the model; agents with vault access
// can only have them filled into a page.
const crypto = require("node:crypto");

const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = new Set(["password", "card", "secret"]);
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const digits = value => String(value ?? "").replace(/\D/g, "");

function luhn(number) {
  let sum = 0;
  for (let index = 0; index < number.length; index++) {
    let digit = Number(number[number.length - 1 - index]);
    if (index % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
function brandOf(number) {
  if (/^4/.test(number)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "American Express";
  if (/^6(011|5)/.test(number)) return "Discover";
  return "Card";
}
// The site a sign-in belongs to: an https origin, or http on this computer.
function siteOf(value) {
  const raw = String(value ?? "").trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? "" : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw) ? "http://" : "https://";
  let url;
  try { url = new URL(scheme + raw); } catch { return null; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) return null;
  return url.origin;
}
// A saved sign-in works on its own host and that host's subdomains.
function matchesSite(entryOrigin, pageUrl) {
  let entry, page;
  try { entry = new URL(entryOrigin); page = new URL(pageUrl); } catch { return false; }
  if (entry.protocol !== page.protocol) return false;
  const base = entry.hostname.replace(/^www\./, "");
  return page.hostname === base || page.hostname.endsWith("." + base);
}

function createVault({ store, cipher, userId }) {
  const owner = () => { const id = userId(); if (!id) throw fail(401, "Sign in to Timewarp."); return id; };
  const ready = () => { if (!cipher.available()) throw fail(503, "This computer's secure storage is unavailable, so the vault can't be used."); };
  const rows = () => store.db.prepare("select * from vault_entries order by lower(label)").all();
  const row = id => store.db.prepare("select * from vault_entries where id = ?").get(id);
  const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
  // Entries belong to the account that saved them.
  const mine = entry => entry && parse(entry.metadata).ownerId === owner();
  const view = entry => {
    const metadata = parse(entry.metadata);
    return {
      id: entry.id, kind: entry.kind, label: entry.label, origin: entry.origin, username: entry.username,
      brand: metadata.brand || null, last4: metadata.last4 || null, expMonth: metadata.expMonth || null, expYear: metadata.expYear || null,
      cardholder: metadata.cardholder || null, notes: metadata.notes || "", createdByAgent: entry.created_by_agent, updatedAt: entry.updated_at,
    };
  };

  function fields(input, current = null) {
    const kind = current?.kind || input.kind;
    if (!KINDS.has(kind)) throw fail(400, "Choose a sign-in, card or secret.");
    const metadata = { ownerId: owner(), notes: clean(input.notes ?? (current && parse(current.metadata).notes), 2000) };
    let label = clean(input.label ?? current?.label, 120), origin = null, username = null, secret = null;
    if (kind === "password") {
      origin = siteOf(input.site ?? current?.origin);
      if (!origin) throw fail(400, "Enter the website, for example example.com.");
      username = clean(input.username ?? current?.username, 320);
      if (input.password !== undefined) { if (!input.password) throw fail(400, "Enter the password."); secret = { password: String(input.password).slice(0, 1000) }; }
      label ||= new URL(origin).hostname.replace(/^www\./, "");
    } else if (kind === "card") {
      const previous = current ? parse(current.metadata) : {};
      if (input.number !== undefined) {
        const number = digits(input.number);
        if (number.length < 12 || number.length > 19 || !luhn(number)) throw fail(400, "Check the card number.");
        secret = { number, cvc: digits(input.cvc).slice(0, 4) };
        Object.assign(metadata, { brand: brandOf(number), last4: number.slice(-4) });
      } else Object.assign(metadata, { brand: previous.brand, last4: previous.last4 });
      const month = Number(input.expMonth ?? previous.expMonth), year = Number(input.expYear ?? previous.expYear);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw fail(400, "Check the expiry date.");
      Object.assign(metadata, { expMonth: month, expYear: year, cardholder: clean(input.cardholder ?? previous.cardholder, 120) });
      label ||= `${metadata.brand} •••• ${metadata.last4}`;
    } else {
      if (input.value !== undefined) { if (!input.value) throw fail(400, "Enter the secret."); secret = { value: String(input.value).slice(0, 10000) }; }
      if (!label) throw fail(400, "Name the secret.");
    }
    if (!current && !secret) throw fail(400, "Enter the secret to save.");
    return { kind, label, origin, username, metadata, secret };
  }

  return {
    available: () => cipher.available(),
    list() { owner(); return rows().filter(mine).map(view); },
    get(id) { const entry = row(id); if (!mine(entry)) throw fail(404, "That vault item no longer exists."); return view(entry); },
    create(input, { agentId = null } = {}) {
      ready();
      const value = fields(input), id = crypto.randomUUID(), at = new Date().toISOString();
      store.db.prepare("insert into vault_entries(id, kind, label, origin, username, metadata, secret, created_by_agent, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)")
        .run(id, value.kind, value.label, value.origin, value.username, JSON.stringify(value.metadata), cipher.encrypt(JSON.stringify(value.secret)), agentId, at, at);
      return view(row(id));
    },
    update(id, input) {
      ready();
      const current = row(id);
      if (!mine(current)) throw fail(404, "That vault item no longer exists.");
      const value = fields(input, current);
      store.db.prepare("update vault_entries set label = ?, origin = ?, username = ?, metadata = ?, secret = ?, updated_at = ? where id = ?")
        .run(value.label, value.origin, value.username, JSON.stringify(value.metadata), value.secret ? cipher.encrypt(JSON.stringify(value.secret)) : current.secret, new Date().toISOString(), id);
      return view(row(id));
    },
    remove(id) { if (!mine(row(id))) throw fail(404, "That vault item no longer exists."); store.db.prepare("delete from vault_entries where id = ?").run(id); return { removed: true }; },
    // Decrypted values, for filling and for the user's own copy action.
    secret(id) {
      ready();
      const entry = row(id);
      if (!mine(entry)) throw fail(404, "That vault item no longer exists.");
      return { ...view(entry), ...JSON.parse(cipher.decrypt(entry.secret)) };
    },
    signInsFor(pageUrl) { return this.list().filter(entry => entry.kind === "password" && matchesSite(entry.origin, pageUrl)); },
  };
}

// safeStorage-backed encryption for the app; tests pass their own cipher.
function safeStorageCipher(safeStorage) {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text).toString("base64"),
    decrypt: value => safeStorage.decryptString(Buffer.from(value, "base64")),
  };
}

module.exports = { createVault, safeStorageCipher, siteOf, matchesSite, luhn };
