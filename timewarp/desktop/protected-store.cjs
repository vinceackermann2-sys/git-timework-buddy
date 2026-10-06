"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function protectedStore(file, encryption) {
  const requireEncryption = () => {
    if (!encryption.isEncryptionAvailable()) throw Error('OS credential encryption is unavailable.');
  };
  return {
    load() {
      if (!fs.existsSync(file)) return null;
      requireEncryption();
      return JSON.parse(encryption.decryptString(fs.readFileSync(file)));
    },
    save(value) {
      requireEncryption();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, encryption.encryptString(JSON.stringify(value)), { mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally { fs.rmSync(temporary, { force: true }); }
    },
  };
}
module.exports = { protectedStore };
