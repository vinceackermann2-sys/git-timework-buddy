// Paying by card through Privy's funding: the onramps switched on in Privy's
// dashboard (Stripe, MoonPay, Meld) with this wallet as the destination, so the
// USDC lands straight in it. Privy only opens them for someone signed in to
// Privy, so the first time it asks for a code sent to the owner's email (their
// Agent ID email, filled in). Privy's windows are its own: this runs outside
// Agent ID's pop-ups, which would otherwise keep the keyboard from them. Loaded
// on demand, since Privy's SDK is large; each new `request` starts a payment.
import { useEffect, useRef } from "react";
import { PrivyProvider, useAddFunds, useLogin, usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";

import { errorMessage } from "@/lib/agent-id/client";
import { useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, PrivyCardSession } from "@/lib/agent-id/types";

export default function PrivyCardFlow({
  agent,
  appId,
  dark,
  request,
}: {
  agent: Agent;
  appId: string;
  dark: boolean;
  request: number;
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
      <Pay agent={agent} request={request} />
    </PrivyProvider>
  );
}

function Pay({ agent, request }: { agent: Agent; request: number }) {
  const { ready, authenticated } = usePrivy();
  const { addFunds } = useAddFunds();
  const refresh = useRefreshAgent();
  const session = useRef<PrivyCardSession | null>(null);
  const afterLogin = useRef(false);
  const handled = useRef(0);

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
      toast.success(
        result.method === "fiat" && result.status === "confirmed" ? "Paid" : "Payment sent",
        { description: "The money shows in the wallet within a few minutes." },
      );
      void refresh(agent.id);
    } catch (caught) {
      // Closing Privy's window rejects too: that's not an error to show.
      const message = errorMessage(caught);
      if (!/exit|clos|cancel|abort/i.test(message)) toast.error(message);
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
      if (code !== "exited_auth_flow") toast.error("Couldn't confirm your email. Try again.");
    },
  });

  useEffect(() => {
    if (!ready || request === handled.current) return;
    handled.current = request;
    void (async () => {
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
        toast.error(errorMessage(caught));
      }
    })();
    // fund and login read refs and stable hooks; a new request is what starts a payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, request]);

  return null;
}
