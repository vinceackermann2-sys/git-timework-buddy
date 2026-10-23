// The public Agent ID site around every page that isn't the app: the header
// with the one action, the footer, and the parts each page is built from.
// The plan behind the copy is docs/agent-id-ladder.md.
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { useSession } from "@/lib/agent-id/session";

export function SitePage({ children }: { children: ReactNode }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1" aria-label="Agent ID">
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link to="/agent-id/check">Check AI or real</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/agent-id/pricing">Pricing</Link>
          </Button>
          {!signedIn && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/agent-id/sign-in">Sign in</Link>
            </Button>
          )}
          <Start size="sm" />
          <ThemeMenu />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-6 text-xs text-[var(--muted-foreground)] sm:px-6">
        <span>© 2026 Timewarp</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="More">
          <Link to="/agent-id/check" className="hover:text-[var(--foreground)]">
            Check AI or real
          </Link>
          <a href="/legal/agent-id-terms" className="hover:text-[var(--foreground)]">
            Agent ID Terms
          </a>
          <a href="/legal/privacy-policy" className="hover:text-[var(--foreground)]">
            Privacy
          </a>
          <a href="/legal/terms-of-service" className="hover:text-[var(--foreground)]">
            Terms
          </a>
        </nav>
      </footer>
    </div>
  );
}

// The one action on every page, in the brand's strongest color; the small one
// in the header hides on phones, where the big one is right below it.
export function Start({ size = "lg" }: { size?: "sm" | "lg" }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <Button
      asChild
      size={size}
      className={cn(
        "rounded-full bg-[var(--aid-ink)] text-[var(--background)] shadow-[0_8px_24px_-8px_var(--aid-ink)] hover:bg-[var(--aid-ink)] hover:opacity-90",
        size === "lg" ? "h-12 px-7 text-base" : "hidden px-4 sm:inline-flex",
      )}
    >
      <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}>
        {signedIn ? "Open Agent ID" : size === "sm" ? "Get started free" : "Get started for free"}
        {size === "lg" && <ArrowRight aria-hidden="true" />}
      </Link>
    </Button>
  );
}

// The action with what it costs beside it.
export function StartRow({ className }: { className?: string }) {
  const signedIn = useSession().status === "signed-in";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-3", className)}>
      <Start />
      {!signedIn && (
        <span className="text-sm text-[var(--muted-foreground)]">
          Free. No card. Just your email.
        </span>
      )}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-wider text-[var(--aid-ink)]">
      {children}
    </p>
  );
}

// A band across the page; tinted ones alternate with plain ones.
export function Band({
  id,
  tinted = false,
  className,
  children,
  label,
}: {
  id?: string;
  tinted?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn(
        "scroll-mt-6",
        tinted && "border-y border-[var(--border)] bg-[var(--card)]/60",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">{children}</div>
    </section>
  );
}

// Lines that pass or fail: what works, and what the usual fixes miss.
export function Checks({ items, tone = "yes" }: { items: ReactNode[]; tone?: "yes" | "no" }) {
  return (
    <ul className="grid gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          {tone === "yes" ? (
            <Check
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--aid-success)]"
              aria-hidden="true"
            />
          ) : (
            <X className="mt-0.5 h-5 w-5 shrink-0 text-[var(--aid-danger)]" aria-hidden="true" />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// The free offer, the same on every page.
export function Offer() {
  return (
    <div className="aid-card p-6 sm:p-8">
      <h2 className="text-2xl font-semibold tracking-tight">Free to start.</h2>
      <p className="mt-3 text-[var(--muted-foreground)]">
        <strong className="font-semibold text-[var(--foreground)]">
          An ID, email, wallet, passports, signed commits, marks and checks are free, with 5 hours
          of computer time.
        </strong>{" "}
        No subscription. More computer time and phone numbers use Timewarp credits.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Start />
        <Link to="/agent-id/pricing" className="aid-link text-sm">
          See pricing
        </Link>
      </div>
    </div>
  );
}

// Questions people ask before they start, answered plainly.
export function Questions({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-12 gap-y-8 md:grid-cols-2">
      {items.map(([question, answer]) => (
        <div key={question}>
          <dt className="font-semibold">{question}</dt>
          <dd className="mt-2 text-[var(--muted-foreground)]">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
