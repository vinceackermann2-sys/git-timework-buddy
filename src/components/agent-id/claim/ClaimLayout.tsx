// The frame of the claim pages: no sidebar and no sign-in, one card in the
// middle, the steps above it, like setting up an account on a phone.
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { CLAIM_STEPS } from "@/lib/agent-id/claims";
import { AppIcon } from "../AppIcons";
import { Avatar } from "../ui";

export function ClaimLayout({
  step,
  children,
  footer,
}: {
  // 0–2: Email, Identity, Ready. Left out on pages outside the steps.
  step?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <ThemeMenu />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-2 sm:pt-10">
        <div className="w-full max-w-md">
          {step !== undefined && <Steps current={step} />}
          <div className="aid-card p-6 sm:p-8">{children}</div>
          {footer && (
            <div className="mt-6 text-center text-sm text-[var(--muted-foreground)]">{footer}</div>
          )}
        </div>
      </main>
    </div>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-4 grid grid-cols-3 gap-2" aria-label="Steps">
      {CLAIM_STEPS.map((label, i) => (
        <li key={label} aria-current={i === current ? "step" : undefined} className="min-w-0">
          <span
            aria-hidden="true"
            className={cn(
              "block h-1 rounded-full transition-colors",
              i <= current ? "bg-[var(--aid-ink)]" : "bg-[var(--border)]",
            )}
          />
          <span
            className={cn(
              "mt-1.5 block text-xs",
              i === current
                ? "font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)]",
            )}
          >
            {i < current && <span className="sr-only">Done: </span>}
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// Title and one line under it: the top of every card.
export function ClaimHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{children}</p>}
    </div>
  );
}

// The agent being set up: its name, the app it asked from and the computer.
export function ClaimAgent({
  name,
  app,
  device,
}: {
  name: string;
  app: { app: string; label: string } | null;
  device: string | null;
}) {
  const where = [app?.label, device].filter(Boolean).join(" on ");
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl bg-[var(--muted)] p-3">
      <Avatar name={name} size="md" />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {where && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            {app && (
              <span aria-hidden="true" className="inline-flex">
                <AppIcon app={app.app} label={app.label} size="xs" tooltip={false} />
              </span>
            )}
            <span className="truncate">{where}</span>
          </p>
        )}
      </div>
    </div>
  );
}
