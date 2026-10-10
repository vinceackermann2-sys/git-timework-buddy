"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createVault } = require("../app/main/vault.cjs");
const { importPasswords } = require("../app/main/vault-import.cjs");

const cipher = { available: () => true, encrypt: text => Buffer.from(text).toString("base64"), decrypt: value => Buffer.from(value, "base64").toString() };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-import-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return createVault({ store, cipher, userId: () => "user-1" });
}

test("browser exports import by column name, skipping duplicates and unusable rows", t => {
  const vault = setup(t);
  // Chrome and Edge: name,url,username,password,note
  const chrome = '﻿name,url,username,password,note\nExample,https://example.com/login,ada@example.com,"pa,ss ""1""",work\nLocal,http://localhost:3000,dev,devpass,\nRouter,http://192.168.1.1/login,admin,x,\nNo password,https://example.net,carol,,\nNot a site,javascript:alert(1),eve,y,\n';
  assert.deepEqual(importPasswords({ vault, text: chrome }), { imported: 3, duplicates: 0, skipped: 2 });
  assert.ok(vault.list().some(item => item.origin === "http://192.168.1.1"), "Plain-http sites, such as a router, are kept");
  const saved = vault.list().find(item => item.origin === "https://example.com");
  assert.deepEqual([saved.label, saved.username, saved.notes], ["Example", "ada@example.com", "work"]);
  assert.equal(vault.secret(saved.id).password, 'pa,ss "1"');
  // Firefox: url,username,password,httpRealm,... and the same sign-in again
  const firefox = '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated"\r\n"https://example.com","ada@example.com","new","","","{1}","1"\r\n"https://accounts.example.dev","ada","pw2","","","{2}","2"\r\n';
  assert.deepEqual(importPasswords({ vault, text: firefox }), { imported: 1, duplicates: 1, skipped: 0 });
  assert.equal(vault.secret(saved.id).password, 'pa,ss "1"', "An existing sign-in isn't overwritten");
  // Bitwarden: login_uri, login_username, login_password
  const bitwarden = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Shop,,,0,https://shop.example,ada,shoppw,\n";
  assert.deepEqual(importPasswords({ vault, text: bitwarden }), { imported: 1, duplicates: 0, skipped: 0 });
});

test("the previous vault's sign-ins for plain-http sites come over", t => {
  const { DatabaseSync } = require("node:sqlite");
  const { importLegacyVault } = require("../app/main/import-legacy.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-legacy-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime);
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec("create table vault_entries(id text primary key not null, dedupeKey text not null, metadata text not null, encryptedSecret text not null, createdAt integer not null, updatedAt integer not null, createdByAgentId text)");
  const sealed = (id, metadata, secret) => "bound:v1:" + JSON.stringify({ ciphertext: cipher.encrypt(JSON.stringify({ id, metadata, secret })), version: 1 });
  const add = (id, origin) => { const metadata = { kind: "password", origin, username: "admin", label: null, source: { type: "manual" } }; db.prepare("insert into vault_entries values (?,?,?,?,?,?,?)").run(id, id, JSON.stringify(metadata), sealed(id, metadata, "pw-" + id), 1, 1, null); };
  add("router", "http://192.168.1.1");
  add("nas", "http://nas.local:5000");
  add("odd", "ftp://files.example");
  db.close();
  const vault = createVault({ store, cipher, userId: () => "user-1" });
  assert.deepEqual(importLegacyVault({ store, vault, decrypt: cipher.decrypt, runtimeDir: runtime }), { signIns: 2, cards: 0, secrets: 0, agents: 0, skipped: 1 });
  assert.deepEqual(vault.list().map(item => item.origin).sort(), ["http://192.168.1.1", "http://nas.local:5000"]);
});

test("files that aren't password exports are refused", t => {
  const vault = setup(t);
  assert.throws(() => importPasswords({ vault, text: "a,b,c\n1,2,3\n" }), /passwords export/);
  assert.throws(() => importPasswords({ vault, text: "  " }), /empty/);
});
