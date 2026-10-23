// The frame of the claim pages: no sidebar and no sign-in, one card in the
// middle, like setting up an account on a phone.
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { AppIcon } from "../AppIcons";
import { AgentAvatar } from "../ui";

export function ClaimLayout({
  children,
  footer,
  wide = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  // The ready screen has a little more to show.
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <ThemeMenu />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-2 sm:pt-12">
        <div className={cn("w-full", wide ? "max-w-lg" : "max-w-md")}>
          <div className="aid-card p-6 sm:p-8">{children}</div>
          {footer && (
            <div className="mt-6 text-center text-sm text-[var(--muted-foreground)]">{footer}</div>
          )}
        </div>
      </main>
    </div>
  );
}

// Title and one line under it: the top of every card.
export function ClaimHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {children && <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{children}</p>}
    </div>
  );
}

// The agent being set up: its name, the app it asked from and the computer.
export function ClaimAgent({
  name,
  app,
  device,
  mascot,
}: {
  name: string;
  app: { app: string; label: string } | null;
  device: string | null;
  mascot?: string | undefined;
}) {
  const where = [app?.label, device].filter(Boolean).join(" on ");
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl bg-[var(--muted)] p-3">
      <AgentAvatar mascot={mascot} id={name} size="md" />
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
