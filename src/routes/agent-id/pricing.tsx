import { Link, createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { PricingDetails } from "@/components/agent-id/Pricing";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/pricing")({
  validateSearch: (search: Record<string, unknown>): { credits?: string } =>
    typeof search["credits"] === "string" ? { credits: search["credits"] } : {},
  head: () => ({ meta: [{ title: "Pricing · Agent ID" }] }),
  component: PricingPage,
});

// The public page; signed in, pricing opens as a popup over the app.
function PricingPage() {
  const session = useSession();
  const signedIn = session.status === "signed-in";
  const { credits: returned } = Route.useSearch();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Brand to={signedIn ? "/agent-id/dashboard" : "/agent-id"} />
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to={signedIn ? "/agent-id/dashboard" : "/agent-id/sign-in"}>
              {signedIn ? "Open Agent ID" : "Sign in"}
            </Link>
          </Button>
          <ThemeMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="mb-8 mt-3 max-w-xl text-lg text-[var(--muted-foreground)]">
          No subscription. Every account gets mail and wallets for free, and pays for the rest with
          Timewarp credits.
        </p>
        <PricingDetails signedIn={signedIn} returned={returned} />
      </main>
    </div>
  );
}
