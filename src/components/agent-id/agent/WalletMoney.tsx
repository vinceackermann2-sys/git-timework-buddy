// Money in and out of a live wallet, as a bank app does it: add money (an
// address on Base with a QR code, or a card where Stripe's onramp is on) and
// withdraw to your own wallet or exchange.
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/agent-id/client";
import {
  amountValue,
  formatUsd,
  isWalletAddress,
  parseAmount,
  shortAddress,
} from "@/lib/agent-id/format";
import { qrPath } from "@/lib/agent-id/qr";
import { queryKeys, shouldRetry, useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, Money } from "@/lib/agent-id/types";
import { CopyButton, ErrorState, Field, LoadingRows, Muted, Notice } from "../ui";

export function AddMoney({ agent }: { agent: Agent }) {
  const info = useQuery({
    queryKey: [...queryKeys.agent(agent.id), "add-money"],
    queryFn: () => api.addMoneyInfo(agent.id),
    retry: shouldRetry,
    staleTime: 60_000,
  });
  const [card, setCard] = useState(false);

  if (info.isPending) return <LoadingRows rows={3} />;
  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  if (card) return <CardOnramp agent={agent} onBack={() => setCard(false)} />;

  const { address, network, assets } = info.data;
  const networkName = network?.name ?? "Base";
  return (
    <div className="grid gap-6">
      {info.data.card.available && (
        <>
          <Button size="lg" className="h-12 rounded-full" onClick={() => setCard(true)}>
            <CreditCard aria-hidden="true" /> Buy with card
          </Button>
          <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            or send from an exchange
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </>
      )}
      {address ? (
        <div className="grid justify-items-center gap-4 text-center">
          <QrCode value={address} />
          <p className="text-sm">
            Send {assets.length ? assets.join(" or ") : "USDC"} on{" "}
            <strong className="font-semibold">{networkName}</strong> from Coinbase, a wallet or any
            exchange.
          </p>
          <div className="w-full">
            <p className="aid-mono break-all rounded-xl bg-[var(--muted)] px-4 py-3 text-sm">
              {address}
            </p>
            <div className="mt-3 flex justify-center">
              <CopyButton
                text={address}
                label="Copy address"
                toastText="Address copied"
                variant={info.data.card.available ? "outline" : "default"}
                className="rounded-full"
              />
            </div>
          </div>
          <Muted>
            Only send on {networkName}. Money sent on another network can be lost. It shows here
            within a few minutes.
          </Muted>
        </div>
      ) : (
        <Muted>The wallet has no address yet.</Muted>
      )}
    </div>
  );
}

export function QrCode({ value }: { value: string }) {
  const { size, path } = qrPath(value);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code of the wallet address"
      className="h-52 w-52 rounded-2xl border border-[var(--border)]"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#172033" />
    </svg>
  );
}

// --- Buying with a card (Stripe's crypto onramp) -------------------------------------

type OnrampWindow = Window & {
  StripeOnramp?: (key: string) => {
    createSession: (options: { clientSecret: string; appearance?: { theme: string } }) => {
      mount: (element: HTMLElement) => void;
    };
  };
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset["loaded"]) return resolve();
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      script.dataset["loaded"] = "1";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error("Couldn't load the card form.")));
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function CardOnramp({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // One onramp session per visit to this panel.
  const session = useQuery({
    queryKey: [...queryKeys.agent(agent.id), "onramp"],
    queryFn: () => api.buyWithCard(agent.id),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  useEffect(() => {
    const data = session.data;
    if (!data) return;
    if (data.url) {
      window.location.assign(data.url);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadScript("https://js.stripe.com/v3/");
        await loadScript("https://crypto-js.stripe.com/crypto-onramp-outer.js");
        const StripeOnramp = (window as OnrampWindow).StripeOnramp;
        const element = mount.current;
        if (cancelled || !element) return;
        if (!StripeOnramp) throw new Error("Couldn't load the card form.");
        element.replaceChildren();
        StripeOnramp(data.publishableKey)
          .createSession({ clientSecret: data.clientSecret })
          .mount(element);
        setMounted(true);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.data]);

  const problem = error ?? (session.isError ? errorMessage(session.error) : null);
  return (
    <div className="grid gap-4">
      {!mounted && !problem && <LoadingRows rows={4} />}
      {problem && <Notice tone="danger">{problem}</Notice>}
      <div ref={mount} className="min-h-0" />
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

// A big dollar amount, as payment apps ask for it: the field grows with the
// number so the dollar sign stays beside it.
export function AmountField({
  id,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const width = Math.min(Math.max(value.length, 1), 10);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Amount in dollars
      </label>
      <div className="flex items-baseline justify-center text-5xl font-semibold tracking-tight">
        <span className="text-[var(--muted-foreground)]">$</span>
        <input
          id={id}
          inputMode="decimal"
          placeholder="0"
          autoComplete="off"
          autoFocus={autoFocus}
          style={{ width: `${width + 0.3}ch` }}
          className="min-w-0 bg-transparent tabular-nums outline-none placeholder:text-[var(--muted-foreground)]/50"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        />
      </div>
    </>
  );
}

// --- Withdrawing --------------------------------------------------------------------

export function Withdraw({
  agent,
  balance,
  onDone,
}: {
  agent: Agent;
  balance: Money | null;
  onDone: () => void;
}) {
  const saved = agent.resources.wallet?.settings.withdrawTo ?? "";
  const [to, setTo] = useState(saved);
  const [amount, setAmount] = useState("");
  const [remember, setRemember] = useState(!saved);
  const refresh = useRefreshAgent();
  const cents = parseAmount(amount);
  const value = amountValue(amount);
  const addressOk = isWalletAddress(to);
  const tooMuch = cents !== null && balance !== null && cents > balance.amount;
  const changed = to.trim().toLowerCase() !== saved.toLowerCase();

  const withdraw = useMutation({
    mutationFn: () =>
      api.withdraw(agent.id, {
        to: to.trim(),
        value: value ?? "",
        ...(remember && changed ? { remember: true } : {}),
      }),
    onSuccess: async (result) => {
      toast.success(
        result.status === "completed"
          ? `Sent ${formatUsd(cents)} to ${shortAddress(to.trim())}`
          : `${formatUsd(cents)} is on its way`,
      );
      onDone();
      await refresh(agent.id, { events: true });
    },
  });

  return (
    <form
      className="grid gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (addressOk && value && !tooMuch && !withdraw.isPending) withdraw.mutate();
      }}
    >
      <div className="py-4 text-center">
        <AmountField id="withdraw-amount" value={amount} onChange={setAmount} autoFocus />
        {balance && (
          <button
            type="button"
            className="mt-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={() => setAmount((balance.amount / 100).toFixed(2))}
          >
            {formatUsd(balance.amount)} available · Withdraw all
          </button>
        )}
        {amount.trim() && !value && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">Enter an amount like 12.50</p>
        )}
        {tooMuch && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">More than the wallet holds</p>
        )}
      </div>
      <Field
        id="withdraw-to"
        label="To"
        hint="Your own wallet or exchange address on Base. It starts with 0x."
        error={to.trim() && !addressOk ? "That isn't a wallet address on Base." : null}
      >
        <Input
          id="withdraw-to"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          className="aid-mono"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Field>
      {changed && (
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          Remember this address
        </label>
      )}
      {withdraw.isError && <Notice tone="danger">{errorMessage(withdraw.error)}</Notice>}
      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-full"
        disabled={!addressOk || !value || tooMuch || withdraw.isPending}
      >
        {withdraw.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Withdraw{value ? ` ${formatUsd(cents)}` : ""}
      </Button>
    </form>
  );
}
