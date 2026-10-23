// The public Agent ID pages, built from the main Timewarp website's own parts
// (timewarp-site/dist): its nav and footer, Quadrant Text headlines, the
// desktop app's frame, the composer, store-artwork cards and the mascots.
// Styles in site.css, scoped to .tw. The copy follows Deus's Copywriting
// Formula (docs/agent-id-ladder.md).
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useStartClaim } from "@/components/agent-id/claim/ClaimFlow";
import { errorMessage } from "@/lib/agent-id/client";
import { useSession } from "@/lib/agent-id/session";
import "./site.css";

// Timewarp's mascots, animated where the main site animates them.
export const MASCOT = {
  cosmo: "/assets/cosmo.png",
  nova: "/assets/nova.png",
  orbit: "/assets/orbit.png",
} as const;
export const MASCOT_LIVE = {
  cosmo: "/assets/cosmo.webp",
  nova: "/assets/nova.webp",
  orbit: "/assets/orbit.webp",
} as const;

// The few line icons the pages use, drawn like the main site's.
const PATHS = {
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M7 7l10 10M17 7 7 17",
  up: "M12 19V6m-6 6 6-6 6 6",
  right: "M5 12h13m-5-5 5 5-5 5",
  panel: "M4 5h16v14H4zM9 5v14",
  left: "m15 6-6 6 6 6",
  next: "m9 6 6 6-6 6",
  lock: "M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  reload: "M19 8a8 8 0 1 0 1 6M19 3v5h-5",
  pause: "M9 5v14M15 5v14",
} as const;
export function Icon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg className={`i ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <div className="tw">
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/agent-id" className="brand" aria-label="Timewarp Agent ID">
            <img src="/assets/timewarp-logo-512.png" alt="" width={34} height={34} />
            <span>Timewarp</span>
            <small>Agent ID</small>
          </Link>
          <nav aria-label="Agent ID">
            <Link to="/agent-id/for/$angle" params={{ angle: "code" }}>
              For code
            </Link>
            <Link to="/agent-id/for/$angle" params={{ angle: "apis" }}>
              For APIs
            </Link>
            <Link to="/agent-id/check">AI or real?</Link>
            <Link to="/agent-id/pricing">Pricing</Link>
          </nav>
          <div className="nav-end">
            {!signedIn && <Link to="/agent-id/sign-in">Sign in</Link>}
            <Link
              to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}
              className="btn btn-sm btn-ink"
            >
              {signedIn ? "Open Agent ID" : "Get started"}
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="wrap footer">
        <Link to="/agent-id" className="brand" aria-label="Timewarp Agent ID">
          <img src="/assets/timewarp-logo-512.png" alt="" width={26} height={26} />
          <span>Timewarp</span>
        </Link>
        <nav className="footer-links" aria-label="More">
          <Link to="/agent-id/check">AI or real?</Link>
          <Link to="/agent-id/pricing">Pricing</Link>
          <a href="/legal/agent-id-terms">Agent ID Terms</a>
          <a href="/legal/privacy-policy">Privacy</a>
          <a href="/">Timewarp app</a>
        </nav>
        <span>Agent ID by Timewarp · © 2026</span>
      </footer>
    </div>
  );
}

// The top of a page: a small label, the promise in Quadrant Text, one line,
// the one action, and the product working below it.
export function Hero({
  kicker,
  title,
  lede,
  actions,
  children,
}: {
  kicker?: string;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="hero">
      <div className="wrap">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {actions ?? <StartButtons />}
      </div>
      {children}
    </section>
  );
}

// The one action, with a quieter second door.
export function StartButtons({ second }: { second?: ReactNode }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <div className="btn-row">
      <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"} className="btn btn-ink">
        {signedIn ? "Open Agent ID" : "Get started for free"}
      </Link>
      {second ?? (
        <Link to="/agent-id/check" className="btn btn-out">
          Check AI or real
        </Link>
      )}
    </div>
  );
}

// The app's composer, taking the email: it sends the code at once, and the
// terms come right after it. Signed in, it opens Agent ID instead.
export function StartComposer() {
  const signedIn = useSession().status === "signed-in";
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const start = useStartClaim();
  if (signedIn) {
    return (
      <div className="btn-row">
        <Link to="/agent-id/dashboard" className="btn btn-ink">
          Open Agent ID
        </Link>
      </div>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (start.isPending) return;
    if (!email.trim()) {
      (event.currentTarget as HTMLFormElement).querySelector("input")?.focus();
      return;
    }
    start.mutate(
      { email: email.trim(), agreed: false },
      { onSuccess: (code) => void navigate({ to: "/agent-id/claim/$code", params: { code } }) },
    );
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="composer">
        <label htmlFor="start-email" className="sr-only">
          Your email
        </label>
        <input
          id="start-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="Your email, and your agents get their IDs"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="c-bar">
          <span className="c-chip">
            <span className="stack">
              <img src={MASCOT.cosmo} alt="" />
              <img src={MASCOT.nova} alt="" />
              <img src={MASCOT.orbit} alt="" />
            </span>
            ID, email, wallet, computer
          </span>
          <button type="submit" className="send" disabled={start.isPending}>
            {start.isPending ? "Sending…" : "Get started for free"}
            <Icon name="up" />
          </button>
        </div>
      </div>
      {start.isError ? (
        <p className="err">{errorMessage(start.error)}</p>
      ) : (
        <p className="fine">
          Free, no card. We'll email you a code. <Link to="/agent-id/pricing">See pricing</Link>
        </p>
      )}
    </form>
  );
}

// The close of a page: the dream in Quadrant Text, then the composer.
export function Closing({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <section className="section wrap" aria-label="Start">
      <p className="greeting" style={{ fontSize: "clamp(34px, 4.6vw, 56px)", lineHeight: 1.08 }}>
        {title}
      </p>
      {lede && <p className="sub">{lede}</p>}
      <div style={{ marginTop: 34 }}>
        <StartComposer />
      </div>
    </section>
  );
}

// The moment everyone knows, in their own words, then the turn.
export function Moment({
  title,
  lines,
  turn,
  source,
}: {
  title: ReactNode;
  lines: ReactNode[];
  turn: ReactNode;
  source?: { text: string; name: string; href: string } | undefined;
}) {
  return (
    <section className="section wrap" aria-label="The moment">
      <h2>{title}</h2>
      <div className="moment">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
        <p className="turn">{turn}</p>
      </div>
      {source && (
        <p className="source">
          {source.text}{" "}
          <a href={source.href} target="_blank" rel="noreferrer">
            {source.name}
          </a>
        </p>
      )}
    </section>
  );
}

export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <section className="section wrap" aria-label="Questions">
      <h2>Good questions.</h2>
      <dl className="faq">
        {items.map(([question, answer]) => (
          <div key={question}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
