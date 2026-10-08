"use strict";
// Requests from Timewarp's account, organization, billing and onboarding
// screens (desktop/*-ui.js), which call window.timewarp.request(action, input).
const BILLING_ROUTES = new Set(["/billing", "/billing/service", "/billing/history"]);

function createLegacyRequests({ services, harness, guard, version, selectModel, registerTools, historyStatus, onboarding = null }) {
  const { auth, chatgpt, funding, integrations } = services;
  return async function request(action, input = {}) {
    switch (action) {
      case "state": return { user: auth.user(), passwordRecovery: auth.passwordRecovery(), version, privacy: "Vaults and payment details stay on this device." };
      case "historyStatus": return historyStatus();
      case "executionStatus": {
        const conversation = harness.conversations.get(input.conversationId);
        return guard.snapshot(conversation.codexThreadId ? [conversation.codexThreadId] : []) || [];
      }
      case "browserAgent": return null;
      case "chatgptDetails": { const state = await funding.current(); if (!state.subscriptionAllowed) await chatgpt.refresh(); return { ...chatgpt.details(), funding: state, login: chatgpt.currentBrowserLogin() }; }
      case "verifyChatgpt": await funding.requireFree(); return chatgpt.verifyAccess();
      case "connectChatgpt": { await auth.accessToken(); await funding.requireFree(); const result = await chatgpt.startBrowserLogin(input); await services.openExternal(result.authUrl); return { status: result.status }; }
      case "cancelChatgpt": return chatgpt.cancelLogin();
      case "disconnectChatgpt": { const result = await chatgpt.disconnect(); await selectModel().catch(() => {}); return result; }
      case "selectChatgpt": await funding.requireFree(); return chatgpt.selectAccount(input.id);
      case "refreshAiFunding": await selectModel(); return funding.current();
      case "refreshTools": integrations.invalidate(); await registerTools(true); return { ready: true };
      case "openConnectorBrowser": await services.ensureCallback(); await services.openExternal(input.url); return { ownerId: null, external: true };
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
      case "cloud": if (!BILLING_ROUTES.has(input.route)) throw new Error("Invalid route."); return services.cloudJson(input.route, input.data || {});
      default: throw new Error("Unknown action.");
    }
  };
}

module.exports = { createLegacyRequests, BILLING_ROUTES };
