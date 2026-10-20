import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/")({ component: AgentIdLanding });

function AgentIdLanding() {
  const session = useSession();
  const signedIn = session.status === "signed-in";

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand />
        <ThemeMenu />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 pb-24 sm:px-6">
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          An identity for every AI agent.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--muted-foreground)]">
          Give each of your agents its own inbox, phone number, wallet, card and machine, and see
          everything it does, traceable to you.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button asChild size="lg" className="h-11 px-6">
            <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/claim"}>
              {signedIn ? "Open Agent ID" : "Get an Agent ID"}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          {!signedIn && (
            <Link to="/agent-id/sign-in" className="aid-link text-sm font-medium">
              Sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
