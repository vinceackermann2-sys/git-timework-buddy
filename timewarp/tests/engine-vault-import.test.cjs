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
  const chrome = '﻿name,url,username,password,note\nExample,https://example.com/login,ada@example.com,"pa,ss ""1""",work\nLocal,http://localhost:3000,dev,devpass,\nInsecure,http://example.org,bob,x,\nNo password,https://example.net,carol,,\n';
  assert.deepEqual(importPasswords({ vault, text: chrome }), { imported: 2, duplicates: 0, skipped: 2 });
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

test("files that aren't password exports are refused", t => {
  const vault = setup(t);
  assert.throws(() => importPasswords({ vault, text: "a,b,c\n1,2,3\n" }), /passwords export/);
  assert.throws(() => importPasswords({ vault, text: "  " }), /empty/);
});
