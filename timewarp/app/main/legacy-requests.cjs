"use strict";
// Requests from Timewarp's account, organization, billing and onboarding
// screens (desktop/*-ui.js), which call window.timewarp.request(action, input).
const BILLING_ROUTES = new Set(["/billing", "/billing/service", "/billing/history"]);

// onFundingChanged tells the interface to reload the models and funding, as
// after a ChatGPT connection, when the AI funding source or plan changes.
function createLegacyRequests({ services, harness, guard, version, selectModel, onFundingChanged = () => {}, registerTools, historyStatus, onboarding = null, openConnector = null, sandbox = null }) {
  const { auth, chatgpt, funding, integrations } = services;
  return async function request(action, input = {}) {
    switch (action) {
      case "state": return { user: auth.user(), passwordRecovery: auth.passwordRecovery(), version, privacy: "Vaults and payment details stay on this device." };
      case "historyStatus": return historyStatus();
      // Only the signed-in user's own chats (harness.conversations.get checks
      // the owner, as the previous app checked the chat's creator); a chat
      // that is missing or someone else's has no status.
      case "executionStatus": {
        const id = typeof input.conversationId === "string" ? input.conversationId : "";
        let conversation = null;
        try { conversation = id ? harness.conversations.get(id) : null; } catch { conversation = null; }
        return conversation?.codexThreadId ? guard.snapshot([conversation.codexThreadId]) || [] : [];
      }
      case "browserAgent": return null;
      case "chatgptDetails": { const state = await funding.current(); if (!state.subscriptionAllowed) await chatgpt.refresh(); return { ...chatgpt.details(), funding: state, login: chatgpt.currentBrowserLogin() }; }
      case "verifyChatgpt": await funding.requireFree(); return chatgpt.verifyAccess();
      case "connectChatgpt": { await auth.accessToken(); await funding.requireFree(); const result = await chatgpt.startBrowserLogin(input); await services.openExternal(result.authUrl); return { status: result.status }; }
      case "cancelChatgpt": return chatgpt.cancelLogin();
      // The default model follows the new catalog (Timewarp's models after a
      // disconnect); open pickers and the composer reload.
      case "disconnectChatgpt": { const result = await chatgpt.disconnect(); await selectModel().catch(() => {}); onFundingChanged(); return result; }
      case "selectChatgpt": await funding.requireFree(); return chatgpt.selectAccount(input.id);
      // After a plan change in Billing.
      case "refreshAiFunding": await selectModel().catch(() => {}); onFundingChanged(); return funding.current();
      case "refreshTools": integrations.invalidate(); await registerTools(true); return { ready: true };
      case "openConnectorBrowser": await services.ensureCallback(); if (openConnector) { openConnector(input.url); return { ownerId: null, external: false }; } await services.openExternal(input.url); return { ownerId: null, external: true };
      case "closeConnectorBrowser": return { closed: true };
      case "authProviders": return services.providers();
      case "signIn": return auth.signIn(input);
      case "signUp": await services.ensureCallback(); return auth.signUp(input);
      case "sendOtp": await services.ensureCallback(); return auth.sendOtp(input.email);
      case "resendConfirmation": await services.ensureCallback(); return auth.resendConfirmation(input.email);
      case "sendRecovery": await services.ensureCallback(); return auth.sendRecovery(input.email);
      case "verifyOtp": return auth.verifyOtp(input.email, input.code, input.type || "email");
      case "updatePassword": return auth.updatePassword(input.password);
      case "signOut": return auth.signOut();
      case "beginOAuth": await services.ensureCallback(); await require("electron").shell.openExternal(await auth.beginOAuth(input.provider)); return { opened: true };
      case "openLink": return services.openExternal(input.url);
      // Accounts without an organization create or join one before using the app.
      case "organizationStatus": {
        const account = await services.cloudJson("/account", {});
        return { active: account.activeOrganization ? { id: account.activeOrganization.id, name: account.activeOrganization.name } : null, invitations: account.activeOrganization ? [] : await services.accountRpc("product.organizations.invitations.pending") };
      }
      case "organizationPictureUpload": return services.accountRpc("product.images.beginUpload");
      case "createOrganization": return services.accountRpc("product.organizations.create", { name: String(input.name || ""), ...input.imageId ? { logo: String(input.imageId) } : {} });
      case "joinOrganization": return services.accountRpc("product.organizations.invitations.accept", { invitationId: String(input.invitationId || "") });
      case "onboardingState": return onboarding ? onboarding.read() : { done: true };
      case "onboardingDetect": if (!onboarding) throw new Error("Setup is unavailable."); return onboarding.detect();
      case "onboardingAction": if (!onboarding) throw new Error("Setup is unavailable."); return onboarding.run(input.action, input);
      // Setup's "Protect work with Windows security" row (sandbox.cjs).
      case "sandboxStatus": return sandbox ? sandbox.status() : { supported: false, status: "ready" };
      case "sandboxSetup": if (!auth.user()) throw new Error("Sign in to Timewarp."); return sandbox ? sandbox.ensure({ setup: true, retry: !!input.retry }) : { supported: false, status: "ready" };
      case "cloud": if (!BILLING_ROUTES.has(input.route)) throw new Error("Invalid route."); return services.cloudJson(input.route, input.data || {});
      default: throw new Error("Unknown action.");
    }
  };
}

module.exports = { createLegacyRequests, BILLING_ROUTES };
