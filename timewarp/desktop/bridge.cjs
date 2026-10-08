"use strict";
const http = require("node:http");
const { Readable } = require("node:stream");
const { assertCloudSafe } = require("../shared/privacy.cjs");
const { accountBalance, billingStatus, funding } = require("./account-compat.cjs");
const { usage } = require("./inherited-usage.cjs");
const { body, raw } = require("./bridge-body.cjs");
// Matches the cloud's 8 MB audio limit plus multipart framing.
const MAX_AUDIO_UPLOAD = 8 * 1024 * 1024 + 64 * 1024;
const { serveProduct, trpcError, wire,readInput,decodeInput } = require("./product-bridge.cjs");

const ALLOWED_ORIGINS = new Set(["app://app", "app://.", "app://energy", "app://timewarp", "http://127.0.0.1:7788"]);
// Feature flags answered locally instead of by PostHog. "passwords" enables the
// device-only vault (Settings → Capabilities → Vault and agent vault commands);
// its entries stay in the safeStorage-encrypted local store.
const LOCAL_FEATURE_FLAGS = Object.freeze({ passwords: true });
function json(res, status, body, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin && ALLOWED_ORIGINS.has(origin)) Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
  res.writeHead(status, headers); res.end(JSON.stringify(body));
}
function createBridge(auth, cloud, port = 7788, services={}) {
  const {chatgpt,integrations,mascots,submitFeedback}=services;
  const aiFunding=chatgpt&&(services.aiFunding||require('./ai-funding.cjs').createAiFunding({cloud,chatgpt,...auth.userId?{userId:()=>auth.userId()}:{}}));
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const fail = (status, message) => json(res, status, req.url?.startsWith('/api/product/trpc/') ? {error:wire(trpcError({status,message}))} : { error: { message }, message }, origin);
    try {
      if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || "")) return fail(403, "Invalid host.");
      if (origin && !ALLOWED_ORIGINS.has(origin)) return fail(403, "Origin is not allowed.");
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const p = url.pathname;
      if (req.method === "OPTIONS") return json(res, 204, null, origin);
      if (p === "/healthz") return json(res, 200, { ok: true, name: "timewarp-device-bridge", version: 1 }, origin);
      if(p.startsWith('/mascots/')&&mascots)return mascots.serve(req,res,p);
      if(p==='/mcp/composio'&&integrations)return integrations.mcp(req,res);
      // Discard telemetry locally; never forward device tool output to cloud.
      if (/^\/(i\/v1|e\/|array\/|replay\/|batch\/|betterstack|flags)/.test(p) || p === "/api/completed-turns" || p === "/api/attribution/first-open") {
        if (p.endsWith(".js")) { req.resume(); res.writeHead(200, { "content-type": "application/javascript", ...(origin ? { "access-control-allow-origin": origin } : {}) }); res.end(""); return; }
        req.resume(); return json(res, 200, p.startsWith("/flags") ? { featureFlags: LOCAL_FEATURE_FLAGS, featureFlagPayloads: {} } : { ok: true }, origin);
      }
      if (p === "/app-notice.json") return json(res, 200, { notice: null }, origin);
      if (p.endsWith("latest.yml")) return fail(404, "Updates are disabled for this development build.");
      if (p === "/api/auth/email-otp/send-verification-otp" && req.method === "POST") {
        const input = await body(req); await auth.sendOtp(input.email); return json(res, 200, { success: true }, origin);
      }
      if (p === "/api/account/auth/auth-code/verify" && req.method === "POST") {
        const input = await body(req); await auth.verifyOtp(input.email, input.code); return json(res, 200, await auth.accountSession(), origin);
      }
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!await auth.authorize(token)) return fail(401, "Sign in to Timewarp.");
      if (p === "/api/account/session" && req.method === "GET") return json(res, 200, await auth.accountSession(), origin);
      if (p === "/api/funding/current" && req.method === "GET") {const state=aiFunding?await aiFunding.current():funding(await accountBalance(cloud));return json(res,200,{canFundUsage:state.canFundUsage,timewarpCredits:state.timewarpCredits},origin);}
      // Native clients cache this credential for calls back to this local
      // bridge. A cloud JWT expires/rotates independently and must never be
      // handed out as the device credential, or chats fail after token refresh.
      if (p === "/api/auth/token" || p === "/api/auth/electron/token") {
        await auth.accessToken();
        return json(res, 200, { token: auth.capability() }, origin);
      }
      if (p === "/api/auth/sign-out") { await auth.signOut(); return json(res, 200, { success: true }, origin); }
      if (p === "/api/prompts/resolve") return fail(404, "Using bundled prompts.");
      if (p === "/connect/accounts" && req.method === "POST") { const input=await body(req);return json(res, 200, integrations?await integrations.legacyAccounts(input.agentId):{ connections: [] }, origin); }
      if (p === "/custom-mcps" && req.method === "GET") return json(res, 200, { items: [] }, origin);
      if (/^\/api\/execution\/agents\/[^/]+\/connector-access$/.test(p) && req.method === "GET") {
        const access=integrations?await integrations.getAccess({agentId:p.split('/')[4]}):{items:[]};
        return json(res,200,{items:(access.items||[]).map(item=>({pluginId:item.integrationId,nangoIntegrationId:item.integrationId,connectionId:item.accountId,connectionOwnerId:auth.userId()})),allConnectedApps:access.items===null},origin);
      }
      if ((p === "/api/execution/connector-grants" || /^\/api\/execution\/agents\/[^/]+\/available-connector-grants$/.test(p)) && req.method === "GET") return json(res, 200, { items: [] }, origin);
      const relay = upstream => {
        const headers = { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" };
        if (origin) headers["access-control-allow-origin"] = origin;
        res.writeHead(upstream.status, headers);
        if (upstream.body) { const stream = Readable.fromWeb(upstream.body); stream.on("error", () => res.destroy()); stream.pipe(res); res.once("close", () => stream.destroy()); }
        else res.end();
      };
      // Dictation uploads multipart audio. Codex has no transcription endpoint,
      // so every plan transcribes through Timewarp and spends Timewarp credits.
      if (p === "/v1/transcriptions") {
        if (req.method !== "POST") return fail(405, "Method not allowed.");
        const type = String(req.headers["content-type"] || "");
        if (!/^multipart\/form-data;\s*boundary=/i.test(type)) return fail(415, "Send the recording as multipart form data.");
        return relay(await cloud(p, await raw(req, MAX_AUDIO_UPLOAD), "POST", type));
      }
      if (p.startsWith("/v1/")) {
        if (req.method !== "GET" && req.method !== "POST") return fail(405, "Method not allowed.");
        const input = req.method === "GET" ? undefined : await body(req);
        // Native client telemetry is not model input. Drop it on-device before
        // validation: millisecond timestamps can coincidentally pass Luhn.
        // Do not exempt numbers in prompts or tool results from the privacy guard.
        if (p === '/v1/responses' && input && typeof input === 'object') delete input.client_metadata;
        if (input !== undefined) assertCloudSafe(input);
        let upstream;
        if(aiFunding&&(await aiFunding.current()).source==='chatgpt'){
          if(p==='/v1/responses'&&req.method==='POST')return fail(409,'Subscription requests use the native Codex provider. Reopen this chat to refresh its provider.');
          else if(p==='/v1/models'&&req.method==='GET')upstream=Response.json(await chatgpt.catalog());
          else return fail(404,'This ChatGPT endpoint is unavailable.');
        }else upstream = await cloud(p, input, req.method);
        return relay(upstream);
      }
      if (p.startsWith("/api/product/trpc/")) {
        const rpcPath = p.slice("/api/product/trpc/".length);
        const runRpc=async(rpc,inputOverride)=>{
        const singleUrl=new URL(url);singleUrl.pathname='/api/product/trpc/'+rpc;
        let result;
        if (rpc === "product.feedback.submit") {
          if(req.method!=='POST')throw Object.assign(Error('Method not allowed.'),{status:405});
          if(!submitFeedback)throw Object.assign(Error('Report submission is unavailable.'),{status:503});
          const input=inputOverride===undefined?await readInput(req,singleUrl):decodeInput(inputOverride);
          result=await submitFeedback(input);
        }
        else if (rpc === "product.organizations.list") result = { organizations: (await auth.accountSession()).organizations };
        else if (rpc === "product.usage.energy") { const balance = await accountBalance(cloud); result = usage(balance, balance.plan && balance.plan !== "free" ? await billingStatus(cloud).catch(() => null) : null); }
        else if (rpc === "product.usage.chatgpt") result = aiFunding&&(await aiFunding.current()).subscriptionAllowed?chatgpt.usage():{ plans: [] };
        else if (rpc === "product.chatgpt.connection") result = aiFunding&&(await aiFunding.current()).subscriptionAllowed?chatgpt.connection():{ status:'disconnected',account:null };
        else if(chatgpt&&rpc==='product.chatgpt.disconnect'){if(req.method!=='POST')throw Object.assign(Error('Method not allowed.'),{status:405});await chatgpt.disconnect();result=null;}
        else if(integrations&&/^product\.integrations\.(?:list|beginConnect|completeConnect|connectWithCredential|disconnect|remove|getAccess|setAccess)$/.test(rpc)){
          const method=rpc.split('.').at(-1);if(!['list','getAccess'].includes(method)&&req.method!=='POST')throw Object.assign(Error('Method not allowed.'),{status:405});
          const input=inputOverride===undefined?await readInput(req,singleUrl):decodeInput(inputOverride);result=await integrations[method](input);
        }
        else if (rpc === "product.surveys.list") result = { surveys: [] };
        // Hosted MCP accounts are separate from the native device MCP manager.
        // The device manager lists the real Composio server and custom servers.
        else if(rpc==='product.integrations.mcps.list')result={items:[]};
        else {
          const reply=await serveProduct(req,res,singleUrl,cloud,auth,token,origin,inputOverride);if(reply!==undefined)return reply;
          return;
        }
        return { result: { data: wire(result) } };
        };
        if(url.searchParams.get('batch')==='1'){
          if(!['GET','POST'].includes(req.method))return fail(405,'Method not allowed.');
          const names=rpcPath.split(',');if(names.length>20||names.some(name=>!/^product\.[\w.]+$/.test(name)||name.endsWith('.subscribe')))return fail(400,'Invalid RPC batch.');
          const inputs=req.method==='GET'?JSON.parse(url.searchParams.get('input')||'{}'):await body(req);
          if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))return fail(400,'Invalid batch inputs.');
          const replies=await Promise.all(names.map(async(name,index)=>{try{if(!Object.hasOwn(inputs,String(index)))throw Object.assign(new Error('Missing batch input.'),{status:400});return {status:200,value:await runRpc(name,inputs[index])};}catch(error){return {status:error.status||503,value:{error:wire(trpcError(error))}};}}));
          const statuses=new Set(replies.map(reply=>reply.status));return json(res,statuses.size===1?replies[0].status:207,replies.map(reply=>reply.value),origin);
        }
        try{const reply=await runRpc(rpcPath);if(reply!==undefined)return json(res,200,reply,origin);}catch(error){return json(res,error.status||503,{error:wire(trpcError(error))},origin);}return;
      }
      if (p.startsWith("/api/execution/")) return fail(410, "Task execution uses the local desktop harness.");
      if (p === "/api/surveys") return json(res, 200, [], origin);
      if (p === "/api/attribution/link-user") return json(res, 200, { linked: false }, origin);
      return fail(404, "This endpoint is unavailable in the Timewarp bridge.");
    } catch (error) {
      if (!res.headersSent) fail(error.status || 400, error.message || "Request failed.");
      else res.destroy();
    }
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  server.on("upgrade", (_req, socket) => { socket.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n"); });
  return server;
}
module.exports = { createBridge, body, ALLOWED_ORIGINS };
