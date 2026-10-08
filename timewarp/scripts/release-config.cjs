"use strict";
// Build-time release checks. On top of the general rules the app itself
// applies, a public Timewarp release must never use the update feed or
// publisher that Timewarp builds inherited before Timewarp had its own source.
const fs = require("node:fs");
const { validateRelease } = require("../shared/release.cjs");

const INHERITED_HOST = /(?:^|\.)(?:getenergy\.com|generalwork\.ai|newco-trace-ingest\.computerwork\.workers\.dev)$/i;
const INHERITED_PUBLISHERS = new Set(["The Computer Work Company, Inc."]);

function checkRelease(value) {
  const release = validateRelease(value);
  if (!release.enabled) return release;
  if (INHERITED_HOST.test(new URL(release.updateUrl).hostname)) throw new Error("A public Timewarp HTTPS update URL is required.");
  if (release.publisherNames.some(name => INHERITED_PUBLISHERS.has(name))) throw new Error("Timewarp signing publisher names are required.");
  return release;
}
const readRelease = file => checkRelease(JSON.parse(fs.readFileSync(file, "utf8")));

module.exports = { checkRelease, readRelease };
