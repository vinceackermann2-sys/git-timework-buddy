// Paying by card through Privy's funding: the onramps switched on in Privy's
// dashboard (Stripe, MoonPay, Meld) with this wallet as the destination, so the
// USDC lands straight in it. Privy only opens them for someone signed in to
// Privy, so the first time it asks for a code sent to the owner's email (their
// Agent ID email, filled in). Loaded on demand: Privy's SDK is large.
import { useRef, useState } from "react";
import { PrivyProvider, useAddFunds, useLogin, usePrivy } from "@privy-io/react-auth";
import { CircleCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/agent-id/client";
import { useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, PrivyCardSession } from "@/lib/agent-id/types";
import { Muted, Notice } from "../ui";

export default function PrivyCardPay({
  agent,
  appId,
  dark,
}: {
  agent: Agent;
  appId: string;
  dark: boolean;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        // Only to pay: no Privy wallet of their own.
        embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
        appearance: {
          theme: dark ? "dark" : "light",
          accentColor: "#7c3aed",
          logo: `${window.location.origin}/desktop-auth-logo.svg`,
          landingHeader: "Confirm your email to pay by card",
        },
      }}
    >
      <Pay agent={agent} />
    </PrivyProvider>
  );
}

type State = "idle" | "opening" | "submitted" | "confirmed";

function Pay({ agent }: { agent: Agent }) {
  const { ready, authenticated } = usePrivy();
  const { addFunds } = useAddFunds();
  const refresh = useRefreshAgent();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<PrivyCardSession | null>(null);
  const afterLogin = useRef(false);

  const fund = async () => {
    const s = session.current;
    if (!s) return;
    try {
      const result = await addFunds({
        destination: { address: s.address, chain: s.chain, asset: s.asset },
        fiat: {
          source: {
            assets: s.currency === "eur" ? ["eur", "usd"] : ["usd", "eur"],
            defaultAsset: s.currency,
          },
          environment: s.environment,
          defaultAmount: "50",
        },
      });
      setState(
        result.method === "fiat" && result.status === "confirmed" ? "confirmed" : "submitted",
      );
      void refresh(agent.id);
    } catch (caught) {
      // Closing Privy's window rejects too: that's not an error to show.
      const message = errorMessage(caught);
      setState("idle");
      if (!/exit|clos|cancel|abort/i.test(message)) setError(message);
    }
  };

  const { login } = useLogin({
    onComplete: () => {
      if (!afterLogin.current) return;
      afterLogin.current = false;
      void fund();
    },
    onError: (code) => {
      afterLogin.current = false;
      setState("idle");
      if (code !== "exited_auth_flow") setError("Couldn't confirm your email. Try again.");
    },
  });

  const start = async () => {
    setError(null);
    setState("opening");
    try {
      // Recorded on Agent ID first, so every card payment is traceable.
      const s = await api.buyWithCard(agent.id);
      if (s.provider !== "privy") throw new Error("Card payments changed. Reload the page.");
      session.current = s;
      if (authenticated) return await fund();
      afterLogin.current = true;
      login({
        loginMethods: ["email"],
        ...(s.email ? { prefill: { type: "email" as const, value: s.email } } : {}),
      });
    } catch (caught) {
      setState("idle");
      setError(errorMessage(caught));
    }
  };

  if (state === "submitted" || state === "confirmed") {
    return (
      <div className="grid justify-items-center gap-3 py-4 text-center">
        <CircleCheck className="h-10 w-10 text-[var(--aid-success)]" aria-hidden="true" />
        <p className="font-medium">{state === "confirmed" ? "Paid" : "Payment sent"}</p>
        <Muted>The money shows in this wallet within a few minutes.</Muted>
        <Button variant="outline" className="rounded-full" onClick={() => setState("idle")}>
          Add more
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 text-center">
      <p className="text-sm">
        Pay with a card, Apple Pay or Google Pay. The money goes straight to this wallet.
      </p>
      <Button
        size="lg"
        className="h-12 rounded-full"
        disabled={!ready || state === "opening"}
        onClick={() => void start()}
      >
        {(!ready || state === "opening") && <Loader2 className="animate-spin" aria-hidden="true" />}
        Pay with card
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
      <Muted>
        {authenticated
          ? "Opens a secure payment window from our payments partner."
          : "The first time, we send a code to your email to confirm it's you."}
      </Muted>
    </div>
  );
}
