"use strict";
const fs = require('node:fs'), path = require('node:path');

// The supplied native runtime identifies itself as 0.0.0. OpenAI consequently
// serves it the legacy catalog. Use OpenAI's complete versioned catalog through
// Codex's supported model_catalog_json option, including native instructions and
// capabilities. Versioned runtimes keep their normal account catalog discovery.
function nativeCatalogConfig(options) {
  const metadata = JSON.parse(fs.readFileSync(path.join(options.packageRoot, 'codex-package.json'), 'utf8'));
  if (metadata.version !== '0.0.0') return [];
  const directory = path.join(options.home, '.local', 'share', 'timewarp');
  const file = path.join(directory, 'codex-models-0.160.1.json');
  const catalog = fs.readFileSync(path.join(__dirname, 'codex-models.json'));
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(catalog)) fs.writeFileSync(file, catalog);
  return [['model_catalog_json', file]];
}
module.exports = { nativeCatalogConfig };
