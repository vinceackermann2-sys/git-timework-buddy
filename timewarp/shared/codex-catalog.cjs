"use strict";
// A bundled catalog bypasses account-scoped discovery and cannot establish plan
// availability. Let Codex refresh its own catalog, including on unversioned builds.
function nativeCatalogConfig() {
  return [];
}
module.exports = { nativeCatalogConfig };
