import { useEffect, useRef, useState } from "react";
import GoogleAuthScreen from "../components/auth/GoogleAuthScreen";
import { consumePendingGoogleOAuth, encryptEnergyDesktopHandoff } from "../lib/googleOAuth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/v1/callback")({ component: GoogleCallback });

function GoogleCallback() {
  const handled = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    new URLSearchParams(window.location.hash.slice(1)).forEach((value, key) =>
      params.set(key, value),
    );
    const pending = consumePendingGoogleOAuth(params.get("state") || "");
    window.history.replaceState(null, "", "/auth/v1/callback");
    if (!pending || pending.target !== "energy-desktop" || !pending.desktop) {
      setError(
        "This Google sign-in request is missing, expired, or has already been used. Start again from the Timewarp app.",
      );
      return;
    }
    const oauthError = params.get("error_description") || params.get("error");
    const idToken = params.get("id_token");
    if (oauthError || !idToken) {
      setError(oauthError || "Google did not return a valid identity token.");
      return;
    }
    void encryptEnergyDesktopHandoff(idToken, pending.desktop)
      .then((code) => {
        const callback = new URL("http://127.0.0.1:17654/oauth-callback");
        callback.searchParams.set("code", code);
        window.location.replace(callback.href);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not return sign-in to the Timewarp app.",
        ),
      );
  }, []);
  return (
    <GoogleAuthScreen
      title="Completing Google sign-in"
      message="Verifying your Timewarp account securely…"
      error={error}
      desktop
    />
  );
}
