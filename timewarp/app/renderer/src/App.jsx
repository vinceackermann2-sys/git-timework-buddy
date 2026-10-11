import React, { useCallback, useEffect, useRef, useState } from "react";
import { call, request, useEvent } from "./api.js";
import { applyAppearance } from "./theme.js";

// The signed-in app (Shell.jsx) loads apart from the sign-in screen, which
// doesn't need it, from the moment someone is known to be signed in. It is
// drawn once loaded, so the splash never waits on a suspended render.
let shell = null, SignedIn = null;
const loadShell = () => (shell ||= import("./Shell.jsx").then(module => { SignedIn = module.SignedIn; }));

// First-run setup, drawn by Timewarp's onboarding screen (screens/onboarding.js).
function Onboarding() {
  const host = useRef(null);
  useEffect(() => { if (host.current) window.timewarpMountOnboarding?.(host.current); }, []);
  return <main ref={host} className="timewarp-onboarding-root" />;
}

export function App() {
  const [state, setState] = useState({ loading: true, signedIn: false });
  const [account, setAccount] = useState(null);
  const [settings, setSettings] = useState(null);
  // Only the latest load applies what it read.
  const loads = useRef(0);

  const load = useCallback(async () => {
    const run = ++loads.current;
    // The settings and who is signed in are read together.
    const [value, status] = await Promise.all([call("settings.get").catch(() => null), request("state").catch(() => ({ user: null }))]);
    if (run !== loads.current) return;
    if (value) { setSettings(value); applyAppearance(value.appearance); }
    if (!status.user || status.passwordRecovery) { setAccount(null); setState({ loading: false, signedIn: false }); return; }
    // The app shows for the signed-in user at once; the rest of the account
    // (picture, organizations), which the cloud has, fills in when it arrives.
    const app = loadShell();
    const full = call("account.get").catch(() => ({ user: status.user }));
    const setup = await call("onboarding.status").catch(() => ({ done: true }));
    if (setup.done) await app;
    if (run !== loads.current) return;
    setAccount(current => current?.user?.id === status.user.id ? current : { user: status.user, loading: true });
    setState({ loading: false, signedIn: true, onboarding: !setup.done });
    const known = await full;
    if (run === loads.current) setAccount(known);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Settings → General → Run setup again shows the first-run screens.
  useEffect(() => { const again = () => void load(); window.addEventListener("tw:setup", again); return () => window.removeEventListener("tw:setup", again); }, [load]);
  useEvent("account.changed", () => { void load().then(() => { if (location.hash === "#/") window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = "#/"; }); });

  if (state.loading || (state.signedIn && !state.onboarding && !SignedIn)) return <div className="tw-splash"><img src="./timewarp-logo.svg" alt="Timewarp" /></div>;
  if (!state.signedIn) return <main id="timewarp-auth-view" className="relative flex h-full w-full items-center justify-center bg-background px-6 py-12 text-foreground" />;
  if (state.onboarding) return <Onboarding />;
  return <SignedIn account={account} setAccount={setAccount} settings={settings || {}} setSettings={setSettings} />;
}
