import { useEffect, useRef, useState } from "react";
import GoogleAuthScreen from "./GoogleAuthScreen";
import { beginGoogleOAuth } from "../../lib/googleOAuth";

export default function GoogleStart() {
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("target") !== "energy-desktop") {
      setError("Start Google sign-in from the Timewarp desktop app.");
      return;
    }
    void beginGoogleOAuth({
      target: "energy-desktop",
      desktop: {
        state: params.get("desktop_state") || "",
        publicKey: params.get("desktop_key") || "",
        nonceHash: params.get("desktop_nonce") || "",
      },
    })
      .then((url) => window.location.replace(url))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      });
  }, []);
  return (
    <GoogleAuthScreen
      title="Opening Google sign-in"
      message="Connecting your Timewarp account securely…"
      error={error}
      desktop
    />
  );
}
