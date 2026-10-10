"use strict";
// The vault: sign-ins, payment cards and secrets kept on this device,
// encrypted with the operating system's key store (Electron safeStorage).
// Secrets never go to the cloud or to the model; agents with vault access
// can only have them filled into a page.
//
// Only what lists an item stays readable in the database: its kind, label,
// site and username, and a card's brand and last four digits. Its values,
// notes and card details are sealed together with its id, kind, label, site,
// username and owner, so an item changed in the database (its site, say, to
// have a password filled on another one) no longer opens.
const crypto = require("node:crypto");

const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = new Set(["password", "card", "secret"]);
const SEALED = "sealed:v2:";
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
// The site a sign-in belongs to: a web origin. Plain http is kept for routers,
// storage boxes and intranet sites, as in the previous app; a site entered
// without one is https, or http on this computer.
function siteOf(value) {
  const raw = String(value ?? "").trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? "" : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw) ? "http://" : "https://";
  let url;
  try { url = new URL(scheme + raw); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname) return null;
  return url.origin;
}
// A saved sign-in works where the previous app filled it: the same protocol,
// the same port and the same host, ignoring a leading "www.". So a sign-in for
// wordpress.com doesn't fill on someone.wordpress.com, nor one for
// localhost:3000 on localhost:5173, nor an http one over https.
function siteKey(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname) return null;
  return { protocol: url.protocol, port: url.port, host: url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "") };
}
function matchesSite(entryOrigin, pageUrl) {
  const entry = siteKey(entryOrigin), page = siteKey(pageUrl);
  return !!entry && !!page && entry.protocol === page.protocol && entry.port === page.port && entry.host === page.host;
}

function createVault({ store, cipher, userId, log = () => {} }) {
  const owner = () => { const id = userId(); if (!id) throw fail(401, "Sign in to Timewarp."); return id; };
  const ready = () => { if (!cipher.available()) throw fail(503, "This computer's secure storage is unavailable, so the vault can't be used."); upgrade(); };
  const rows = () => store.db.prepare("select * from vault_entries order by lower(label)").all();
  const row = id => store.db.prepare("select * from vault_entries where id = ?").get(id);
  const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
  // Entries belong to the account that saved them.
  const mine = entry => entry && parse(entry.metadata).ownerId === owner();
  // values: the item's sealed values, or null when they can't be read here.
  const view = (entry, values) => {
    const metadata = parse(entry.metadata);
    return {
      id: entry.id, kind: entry.kind, label: entry.label, origin: entry.origin, username: entry.username,
      brand: metadata.brand || null, last4: metadata.last4 || null, expMonth: values?.expMonth || null, expYear: values?.expYear || null,
      cardholder: values?.cardholder || null, notes: values?.notes || "", createdByAgent: entry.created_by_agent, updatedAt: entry.updated_at,
    };
  };

  // What an item's values are sealed with; changing any of it in the database
  // makes the item fail to open.
  const binding = entry => ({ id: entry.id, kind: entry.kind, label: entry.label, origin: entry.origin ?? null, username: entry.username ?? null, ownerId: parse(entry.metadata).ownerId ?? null });
  const seal = (entry, values) => SEALED + cipher.encrypt(JSON.stringify({ ...binding(entry), values }));
  // Items saved before values were sealed: only the secret was encrypted, and
  // notes and card details were stored as they were.
  function unsealedValues(entry) {
    const metadata = parse(entry.metadata), secret = JSON.parse(cipher.decrypt(entry.secret));
    return { ...secret, notes: metadata.notes || "", ...(entry.kind === "card" ? { cardholder: metadata.cardholder || "", expMonth: metadata.expMonth ?? null, expYear: metadata.expYear ?? null } : {}) };
  }
  // The item's values: its password, card number or secret, notes and card details.
  function open(entry) {
    if (!String(entry.secret).startsWith(SEALED)) return unsealedValues(entry);
    let sealed;
    try { sealed = JSON.parse(cipher.decrypt(entry.secret.slice(SEALED.length))); }
    catch { throw fail(500, "This vault item can't be read on this computer."); }
    const bound = binding(entry);
    if (!sealed?.values || typeof sealed.values !== "object" || Object.keys(bound).some(key => sealed[key] !== bound[key]))
      throw fail(409, "This vault item failed its integrity check: it was changed outside Timewarp. Delete it and save it again.");
    return sealed.values;
  }
  // Only the owner and a card's brand and ending stay readable.
  const listedMetadata = (entry, values) => ({ ownerId: parse(entry.metadata).ownerId, ...(entry.kind === "card" && values.number ? { brand: brandOf(values.number), last4: values.number.slice(-4) } : {}) });
  // Items saved before values were sealed are sealed once the key store is available.
  let upgraded = false;
  function upgrade() {
    if (upgraded || !cipher.available()) return;
    upgraded = true;
    const pending = rows().filter(entry => !String(entry.secret).startsWith(SEALED));
    if (pending.length) store.transaction(() => {
      for (const entry of pending) {
        try {
          const values = unsealedValues(entry);
          store.db.prepare("update vault_entries set metadata = ?, secret = ? where id = ?").run(JSON.stringify(listedMetadata(entry, values)), seal(entry, values), entry.id);
        } catch (error) { log("A vault item could not be sealed.", error.message); }
      }
    });
  }
  // As listed: with its notes and card details when it can be opened here, or
  // marked damaged when it fails its integrity check.
  const listed = entry => {
    if (!cipher.available()) return view(entry, null);
    try { return view(entry, open(entry)); } catch { return { ...view(entry, null), damaged: true }; }
  };

  // imported: a card from the previous app keeps the number it had there,
  // even one that fails the checksum.
  function fields(input, current = null, previous = {}, { imported = false } = {}) {
    const kind = current?.kind || input.kind;
    if (!KINDS.has(kind)) throw fail(400, "Choose a sign-in, card or secret.");
    const metadata = { ownerId: owner() }, values = { notes: clean(input.notes ?? previous.notes, 2000) };
    let label = clean(input.label ?? current?.label, 120), origin = null, username = null;
    if (kind === "password") {
      origin = siteOf(input.site ?? current?.origin);
      if (!origin) throw fail(400, "Enter the website, for example example.com.");
      username = clean(input.username ?? current?.username, 320);
      if (input.password !== undefined) { if (!input.password) throw fail(400, "Enter the password."); values.password = String(input.password).slice(0, 1000); }
      else if (previous.password) values.password = previous.password;
      label ||= new URL(origin).hostname.replace(/^www\./, "");
    } else if (kind === "card") {
      if (input.number !== undefined) {
        const number = digits(input.number);
        if (number.length < 12 || number.length > 19 || (!imported && !luhn(number))) throw fail(400, "Check the card number.");
        // Like the previous app, security codes are never stored.
        values.number = number;
      } else if (previous.number) values.number = previous.number;
      if (values.number) Object.assign(metadata, { brand: brandOf(values.number), last4: values.number.slice(-4) });
      const month = Number(input.expMonth ?? previous.expMonth), year = Number(input.expYear ?? previous.expYear);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw fail(400, "Check the expiry date.");
      Object.assign(values, { expMonth: month, expYear: year, cardholder: clean(input.cardholder ?? previous.cardholder, 120) });
      label ||= `${metadata.brand} •••• ${metadata.last4}`;
    } else {
      if (input.value !== undefined) { if (!input.value) throw fail(400, "Enter the secret."); values.value = String(input.value).slice(0, 10000); }
      else if (previous.value) values.value = previous.value;
      if (!label) throw fail(400, "Name the secret.");
    }
    if (!values.password && !values.number && !values.value) throw fail(400, "Enter the secret to save.");
    return { kind, label, origin, username, metadata, values };
  }

  upgrade();
  // An item's row, sealed: what's bound comes from the row as it is written.
  const write = (id, value, extra) => {
    const entry = { id, kind: value.kind, label: value.label, origin: value.origin, username: value.username, metadata: JSON.stringify(value.metadata) };
    return { ...entry, secret: seal(entry, value.values), ...extra };
  };
  return {
    available: () => cipher.available(),
    list() { owner(); upgrade(); return rows().filter(mine).map(listed); },
    get(id) { const entry = row(id); if (!mine(entry)) throw fail(404, "That vault item no longer exists."); return listed(entry); },
    // With `dedupe` (a set of "origin\nusername" keys), an existing sign-in is
    // left alone and null is returned. `imported`: see fields().
    create(input, { agentId = null, dedupe = null, imported = false } = {}) {
      ready();
      const value = fields(input, null, {}, { imported }), id = crypto.randomUUID(), at = new Date().toISOString();
      if (dedupe && value.kind === "password") {
        const key = value.origin + "\n" + (value.username || "");
        if (dedupe.has(key)) return null;
        dedupe.add(key);
      }
      const entry = write(id, value);
      store.db.prepare("insert into vault_entries(id, kind, label, origin, username, metadata, secret, created_by_agent, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)")
        .run(id, entry.kind, entry.label, entry.origin, entry.username, entry.metadata, entry.secret, agentId, at, at);
      return listed(row(id));
    },
    // An item that fails its integrity check can't be edited, only removed.
    update(id, input) {
      ready();
      const current = row(id);
      if (!mine(current)) throw fail(404, "That vault item no longer exists.");
      const entry = write(id, fields(input, current, open(current)));
      store.db.prepare("update vault_entries set label = ?, origin = ?, username = ?, metadata = ?, secret = ?, updated_at = ? where id = ?")
        .run(entry.label, entry.origin, entry.username, entry.metadata, entry.secret, new Date().toISOString(), id);
      return listed(row(id));
    },
    remove(id) { if (!mine(row(id))) throw fail(404, "That vault item no longer exists."); store.db.prepare("delete from vault_entries where id = ?").run(id); return { removed: true }; },
    // Opened values, for filling and for the user's own copy action. A card's
    // brand and ending come from its sealed number, not the listed copy.
    secret(id) {
      ready();
      const entry = row(id);
      if (!mine(entry)) throw fail(404, "That vault item no longer exists.");
      const values = open(entry);
      return { ...view(entry, values), ...values, ...(values.number ? { brand: brandOf(values.number), last4: values.number.slice(-4) } : {}) };
    },
    // Sign-ins for a page, leaving out items that fail their integrity check.
    signInsFor(pageUrl) {
      owner(); upgrade();
      return rows().filter(entry => entry.kind === "password" && mine(entry) && matchesSite(entry.origin, pageUrl)).map(listed).filter(entry => !entry.damaged);
    },
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
