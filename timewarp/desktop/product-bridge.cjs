"use strict";
const { body } = require("./bridge-body.cjs");
const { assertCloudSafe } = require("../shared/privacy.cjs");

async function readInput(req, url) {
  let input = req.method === "GET" ? JSON.parse(url.searchParams.get("input") || "{}") : await body(req);
  return decodeInput(input);
}
function decodeInput(input) {
  if (input && Object.hasOwn(input, "json") && Object.keys(input).every(key => ["json", "meta"].includes(key))) input = input.json;
  return assertCloudSafe(input || {});
}
async function cloudResult(cloud, rpc, input) {
  const response = await cloud("/native/rpc", { rpc, input });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(value?.error?.message || value?.error || "Cloud request failed."), { status: response.status });
  return value;
}
function trpcError(error) {
  const status = error.status || 503, code = ({ 400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "BAD_REQUEST", 429: "TOO_MANY_REQUESTS" })[status] || "INTERNAL_SERVER_ERROR";
  return { message: error.message || "Cloud request failed.", code: -32603, data: { code, httpStatus: status } };
}
// The original desktop's tRPC links use SuperJSON in both directions. Hosted
// responses contain JSON values (timestamps are strings), so the JSON envelope
// is sufficient; omitting it makes the real client's deserialize return void.
const wire = value => ({ json: value });
async function serveProduct(req, res, url, cloud, auth, token, origin, inputOverride) {
  const rpc = url.pathname.slice("/api/product/trpc/".length);
  if (!['GET','POST'].includes(req.method)) throw Object.assign(new Error('Method not allowed.'), { status: 405 });
  if (/^product\.(?:vault|secretInputs|files)\./.test(rpc)) throw Object.assign(new Error('Device vaults and files stay on this computer.'), { status: 403 });
  if(!/^product\.(?:organizations\.|profile\.update$|images\.beginUpload$)/.test(rpc))throw Object.assign(new Error('This feature uses the local desktop harness.'),{status:410});
  const input = inputOverride===undefined?await readInput(req,url):decodeInput(inputOverride);
  return { result: { data: wire(await cloudResult(cloud,rpc,input)) } };
}
module.exports={serveProduct,trpcError,cloudResult,readInput,decodeInput,wire};
