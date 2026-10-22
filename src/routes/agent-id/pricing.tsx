import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Brand, ThemeMenu } from "@/components/agent-id/Brand";
import { ResourceArt, type ArtKind } from "@/components/agent-id/ResourceArt";
import { Chip, Notice } from "@/components/agent-id/ui";
import { errorMessage } from "@/lib/agent-id/client";
import { formatTimeLeft } from "@/lib/agent-id/format";
import { useAccount } from "@/lib/agent-id/queries";
import { api, claimsApi, useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/pricing")({
  validateSearch: (search: Record<string, unknown>): { credits?: string } =>
    typeof search["credits"] === "string" ? { credits: search["credits"] } : {},
  head: () => ({ meta: [{ title: "Pricing · Agent ID" }] }),
  component: PricingPage,
});

// Used until the server says otherwise (older servers leave pricing out).
const FALLBACK = {
  computeFreeHours: 5,
  computeCreditsPerHour: 2.2,
  creditPacks: [15, 30, 45, 60, 75, 100, 125].map((priceUsd) => ({
    credits: priceUsd * 12,
    priceUsd,
  })),
};

const usd = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);

// No subscription: what an agent has and what it costs, and Timewarp credits
// for what isn't free.
function PricingPage() {
  const session = useSession();
  const signedIn = session.status === "signed-in";
  const account = useAccount();
  const { credits: returned } = Route.useSearch();
  const config = useQuery({
    queryKey: ["agent-id", "public-config"],
    queryFn: () => claimsApi.config(),
    enabled: !signedIn,
    staleTime: 5 * 60_000,
  });
  const pricing = (signedIn ? account.data?.config.pricing : config.data?.pricing) ?? FALLBACK;
  const compute = signedIn ? account.data?.compute : undefined;
  const freeLeft = compute ? Math.max(0, compute.freeSeconds - compute.usedSeconds) : null;

  const rows: { kind: ArtKind; name: string; detail: string; price: string; soon?: boolean }[] = [
    {
      kind: "mail",
      name: "Mail",
      detail: "Its own email address, to send and receive.",
      price: "Free",
    },
    {
      kind: "wallet",
      name: "Wallet",
      detail:
        "Dollars as USDC and USDT. Adding or withdrawing by card or bank has a small fee from the payment provider, shown before you pay.",
      price: "Free",
    },
    {
      kind: "vm",
      name: "Computer",
      detail: "Its own Linux computer, running only while it's used.",
      price: `${pricing.computeFreeHours} hours free, then ${pricing.computeCreditsPerHour} credits an hour`,
    },
    {
      kind: "phone",
      name: "Phone number",
      detail: "Its own number for texts and calls. Apply on an agent's Phone tab.",
      price: "Credits",
      soon: true,
    },
    {
      kind: "card",
      name: "Virtual card",
      detail: "Pays online within the limits you set. Apply on an agent's Card tab.",
      price: "Credits",
      soon: true,
    },
  ];

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
        <p className="mt-3 max-w-xl text-lg text-[var(--muted-foreground)]">
          No subscription. Every account gets mail and wallets for free, and pays for the rest with
          Timewarp credits.
        </p>

        <ul className="aid-card mt-8 divide-y divide-[var(--border)] overflow-hidden">
          {rows.map((row) => (
            <li key={row.kind} className="flex items-start gap-4 px-5 py-4">
              <ResourceArt kind={row.kind} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {row.name}
                  {row.soon && <Chip>Coming soon</Chip>}
                </p>
                <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{row.detail}</p>
              </div>
              <p
                className={cn(
                  "max-w-[11rem] shrink-0 text-right text-sm font-semibold",
                  row.price === "Free" && "text-[var(--aid-success)]",
                )}
              >
                {row.price}
              </p>
            </li>
          ))}
        </ul>

        <section aria-labelledby="credits" className="mt-12">
          <h2 id="credits" className="text-2xl font-semibold tracking-tight">
            Timewarp credits
          </h2>
          <p className="mt-2 text-[var(--muted-foreground)]">
            The same credits as in the Timewarp app, used for everything that isn't free.
          </p>
          {returned === "added" && (
            <Notice tone="success" className="mt-4">
              Payment received. Your credits are added within a minute.
            </Notice>
          )}
          {freeLeft !== null && (
            <p className="mt-4 text-sm">
              <span className="font-medium">{formatTimeLeft(freeLeft)}</span>
              <span className="text-[var(--muted-foreground)]"> of free computer time left.</span>
            </p>
          )}
          {signedIn ? (
            <CreditPacks packs={pricing.creditPacks} />
          ) : (
            <Button asChild size="lg" className="mt-5 h-12 rounded-full px-7">
              <Link to="/agent-id/sign-in" search={{ redirect: "/agent-id/pricing" }}>
                Sign in to add credits
              </Link>
            </Button>
          )}
        </section>
      </main>
    </div>
  );
}

function CreditPacks({ packs }: { packs: { credits: number; priceUsd: number }[] }) {
  const [chosen, setChosen] = useState(packs[1]?.credits ?? packs[0]?.credits ?? 0);
  const buy = useMutation({
    mutationFn: () => api.buyCredits(chosen),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <div className="mt-5 grid gap-4">
      <div
        role="radiogroup"
        aria-label="Credit pack"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {packs.map((pack) => (
          <button
            key={pack.credits}
            type="button"
            role="radio"
            aria-checked={chosen === pack.credits}
            onClick={() => setChosen(pack.credits)}
            className={cn(
              "rounded-xl border-2 px-3 py-3 text-left transition-colors",
              chosen === pack.credits
                ? "border-[var(--aid-ink)] bg-[var(--accent)]"
                : "border-[var(--border)] hover:border-[var(--input)]",
            )}
          >
            <span className="block font-semibold tabular-nums">
              {pack.credits.toLocaleString("en-US")} credits
            </span>
            <span className="block text-sm text-[var(--muted-foreground)]">
              {usd(pack.priceUsd)}
            </span>
          </button>
        ))}
      </div>
      {buy.isError && <Notice tone="danger">{errorMessage(buy.error)}</Notice>}
      <div>
        <Button
          size="lg"
          className="h-12 rounded-full px-7"
          disabled={!chosen || buy.isPending}
          onClick={() => buy.mutate()}
        >
          {buy.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Add credits
        </Button>
      </div>
    </div>
  );
}
