// Money in and out of a live wallet, as a bank app does it: add money (a card,
// one SEPA transfer of an amount you choose, or crypto to its address on Base)
// and withdraw to your bank account or your own wallet or exchange.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
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
import {
  queryKeys,
  shouldRetry,
  useAccount,
  useBank,
  useRefreshAgent,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { AddMoneyInfo, Agent, Money } from "@/lib/agent-id/types";
import { CopyButton, ErrorState, Field, LoadingRows, Muted, Notice, Segmented } from "../ui";
import { BankDeposit, BankWithdraw } from "./BankMoney";
import { useAgentIdTheme } from "../AgentIdShell";

type AddMethod = "card" | "bank" | "crypto";
// Privy's SDK is large: it loads only when someone opens Card.
const PrivyCardPay = lazy(() => import("./PrivyCardPay"));

export function AddMoney({ agent }: { agent: Agent }) {
  const info = useQuery({
    queryKey: [...queryKeys.agent(agent.id), "add-money"],
    queryFn: () => api.addMoneyInfo(agent.id),
    retry: shouldRetry,
    staleTime: 60_000,
  });
  const [chosen, setChosen] = useState<AddMethod | null>(null);
  const { choice } = useAgentIdTheme();
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const bankOn = info.data?.bank?.available === true;
  const bank = useBank(bankOn);

  if (info.isPending) return <LoadingRows rows={3} />;
  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;

  // SEPA, unless the bank check opened US dollars only.
  const currencies = bank.data?.status === "approved" ? bank.data.currencies : null;
  const bankLabel = currencies && !currencies.includes("eur") ? "Bank" : "SEPA";
  const available: Record<AddMethod, boolean> = {
    card: info.data.card.available,
    bank: bankOn,
    crypto: true,
  };
  const offered = (
    [
      { value: "card", label: "Card" },
      { value: "bank", label: bankLabel },
      { value: "crypto", label: "Crypto" },
    ] as { value: AddMethod; label: string }[]
  ).filter((m) => available[m.value]);
  const method = chosen && offered.some((m) => m.value === chosen) ? chosen : offered[0]!.value;
  return (
    <div className="grid gap-6">
      {offered.length > 1 && (
        <Segmented
          label="How to add money"
          value={method}
          onChange={setChosen}
          options={offered}
          className="w-full [&>button]:flex-1"
        />
      )}
      {method === "bank" ? (
        <BankDeposit agent={agent} />
      ) : method === "card" ? (
        info.data.card.provider === "privy" && info.data.card.privy ? (
          <Suspense fallback={<LoadingRows rows={2} />}>
            <PrivyCardPay agent={agent} appId={info.data.card.privy.appId} dark={dark} />
          </Suspense>
        ) : info.data.card.provider === "moonpay" ? (
          <CardPay agent={agent} />
        ) : (
          <CardOnramp agent={agent} />
        )
      ) : (
        <CryptoDeposit info={info.data} />
      )}
    </div>
  );
}

function CryptoDeposit({ info }: { info: AddMoneyInfo }) {
  const { address, network, assets } = info;
  const networkName = network?.name ?? "Base";
  return (
    <div className="grid gap-6">
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
                variant="default"
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

// --- Paying by card (MoonPay) ----------------------------------------------------------

// MoonPay's page in a new tab, with this wallet filled in and locked: the card,
// Apple Pay or Google Pay there, and the USDC lands here.
function CardPay({ agent }: { agent: Agent }) {
  const open = useMutation({
    mutationFn: async () => {
      // Opened right away, so the browser doesn't block it as a pop-up.
      const tab = window.open("about:blank", "_blank");
      try {
        const session = await api.buyWithCard(agent.id);
        if (tab && "url" in session && session.url) {
          tab.opener = null;
          tab.location.href = session.url;
        } else tab?.close();
        return session;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });
  return (
    <div className="grid gap-4 text-center">
      <p className="text-sm">
        Pay with a card, Apple Pay or Google Pay. The money goes straight to this wallet.
      </p>
      <Button
        size="lg"
        className="h-12 rounded-full"
        disabled={open.isPending}
        onClick={() => open.mutate()}
      >
        {open.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Pay with card
        <ExternalLink aria-hidden="true" />
      </Button>
      {open.isError && <Notice tone="danger">{errorMessage(open.error)}</Notice>}
      <Muted>
        {open.isSuccess
          ? "Finish paying in the new tab. The money shows here within a few minutes."
          : "MoonPay takes the payment and asks for your ID the first time, as card rules require."}
      </Muted>
    </div>
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

function CardOnramp({ agent }: { agent: Agent }) {
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

  // Stripe's answer (MoonPay's goes to CardPay).
  const stripeSession = session.data && "clientSecret" in session.data ? session.data : undefined;

  useEffect(() => {
    const data = stripeSession;
    const publishableKey = data?.publishableKey;
    if (!data || !publishableKey) return;
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
        StripeOnramp(publishableKey)
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
  }, [stripeSession]);

  const url = session.data && "url" in session.data ? session.data.url : undefined;
  const problem =
    error ??
    (session.isError
      ? errorMessage(session.error)
      : session.data && !stripeSession?.publishableKey && !url
        ? "Couldn't open the card form."
        : null);
  // Without an embed, Stripe's own page, in a new tab.
  const hosted = session.data && !stripeSession?.publishableKey ? url : undefined;
  return (
    <div className="grid gap-4">
      {problem && <Notice tone="danger">{problem}</Notice>}
      {hosted ? (
        <div className="grid gap-3 text-center">
          <Button asChild size="lg" className="h-12 rounded-full">
            <a href={hosted} target="_blank" rel="noopener noreferrer">
              Buy with card <ExternalLink aria-hidden="true" />
            </a>
          </Button>
          <Muted>
            Stripe sends the USDC straight to this wallet. It shows here within minutes.
          </Muted>
        </div>
      ) : (
        !mounted && !problem && <LoadingRows rows={4} />
      )}
      <div ref={mount} className="min-h-0" />
    </div>
  );
}

// A big amount, as payment apps ask for it: the field grows with the number
// so the currency sign stays beside it.
export function AmountField({
  id,
  value,
  onChange,
  autoFocus = false,
  currency = "usd",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  currency?: "usd" | "eur";
}) {
  const width = Math.min(Math.max(value.length, 1), 10);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {currency === "eur" ? "Amount in euros" : "Amount in dollars"}
      </label>
      <div className="flex items-baseline justify-center text-5xl font-semibold tracking-tight">
        <span className="text-[var(--muted-foreground)]">{currency === "eur" ? "€" : "$"}</span>
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

// To the owner's bank account (live wallets, where bank transfers are on) or
// to their own crypto wallet or exchange.
export function Withdraw({
  agent,
  balance,
  onDone,
}: {
  agent: Agent;
  balance: Money | null;
  onDone: () => void;
}) {
  const bankOn =
    useAccount().data?.config.bank?.available === true && agent.resources.wallet?.mode === "live";
  const [to, setTo] = useState<"bank" | "crypto">("bank");
  if (!bankOn) return <CryptoWithdraw agent={agent} balance={balance} onDone={onDone} />;
  return (
    <div className="grid gap-5">
      <Segmented
        label="Withdraw to"
        value={to}
        onChange={setTo}
        options={[
          { value: "bank", label: "Bank account" },
          { value: "crypto", label: "Crypto wallet" },
        ]}
        className="w-full [&>button]:flex-1"
      />
      {to === "bank" ? (
        <BankWithdraw agent={agent} balance={balance} onDone={onDone} />
      ) : (
        <CryptoWithdraw agent={agent} balance={balance} onDone={onDone} />
      )}
    </div>
  );
}

function CryptoWithdraw({
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
        hint={
          agent.resources.wallet?.mode === "test"
            ? "Test dollars leave this wallet; nothing is sent anywhere."
            : "Your own wallet or exchange address on Base. It starts with 0x."
        }
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
