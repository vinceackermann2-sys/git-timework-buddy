import type { ReactNode } from "react";
import "./google-auth-screen.css";

export default function GoogleAuthScreen({
  title,
  message,
  error,
  desktop = false,
}: {
  title: string;
  message: string;
  error?: string;
  desktop?: boolean;
}) {
  const signal: ReactNode = error ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6m0 4h.01" />
    </svg>
  ) : (
    <span className="ring" />
  );

  return (
    <main className="timewarp-auth-page">
      <div className="brand">
        <img src="/desktop-auth-logo.svg" alt="" />
        <span>Timewarp</span>
      </div>
      <section className="card" aria-labelledby="google-auth-title">
        <div className="signal" aria-hidden="true">
          {signal}
        </div>
        <h1 id="google-auth-title">{error ? "Sign-in could not complete" : title}</h1>
        <p role={error ? "alert" : "status"} aria-live="polite">
          {error || message}
        </p>
        {error && !desktop && (
          <div className="actions">
            <a href="/login">Return to sign in</a>
          </div>
        )}
      </section>
      <p className="hint">
        {error && desktop
          ? "Start again from the Timewarp app."
          : "You’ll return to Timewarp when sign-in is complete."}
      </p>
    </main>
  );
}
