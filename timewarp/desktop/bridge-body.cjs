"use strict";
async function raw(req, max) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function body(req, max = 2 * 1024 * 1024) {
  const bytes = await raw(req, max);
  if (!bytes.length) return {};
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}
module.exports={body,raw};
