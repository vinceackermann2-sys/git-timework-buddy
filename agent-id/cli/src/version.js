import fs from 'node:fs';

export const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
})();
