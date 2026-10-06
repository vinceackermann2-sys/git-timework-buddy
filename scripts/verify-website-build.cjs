"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "timewarp-site/dist");
const output = path.join(root, ".output/public");
let count = 0;
function verify(directory, relative = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) verify(path.join(directory, entry.name), name);
    else if (name !== "index.html") {
      assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(source, name)), "Hosted asset differs or is missing: " + name);
      count++;
    }
  }
}
verify(source);
console.log("All " + count + " existing website assets are present in the production build.");
