"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "timewarp-site/dist");
const target = path.join(root, "public");
fs.mkdirSync(target, { recursive: true });
for (const entry of fs.readdirSync(source)) {
  // The index route returns the original HTML; Nitro serves its static assets.
  if (entry === "index.html") continue;
  fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });
}
console.log("Existing Timewarp website assets prepared for Lovable hosting.");
