// Bank transfers in and out of a live wallet, through Bridge (a Stripe
// company): the owner verifies with Bridge once, then each wallet has its own
// bank details for deposits (they arrive as USDC), and withdrawals go to the
// owner's own bank account. Bank numbers stay with Bridge.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Landmark, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/agent-id/client";
import { amountValue, formatUsd, parseAmount } from "@/lib/agent-id/format";
import { queryKeys, shouldRetry, useBank, useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type {
  Agent,
  BankAccount,
  BankCurrency,
  BankDeposit as Deposit,
  BankStatus,
  Money,
  NewBankAccount,
} from "@/lib/agent-id/types";
import { CopyButton, ErrorState, Field, LoadingRows, Muted, Notice, Segmented } from "../ui";
import { AmountField } from "./WalletMoney";

const CURRENCY_LABELS: Record<BankCurrency, string> = { usd: "US dollars", eur: "Euros" };
const RAIL_LABELS: Record<BankAccount["rail"], string> = { ach: "ACH", wire: "Wire", sepa: "SEPA" };

export const bankAccountLabel = (account: BankAccount) =>
  `${account.bankName ?? "Bank"} ••${account.last4}`;

// Where a withdrawal to a bank is, from Bridge's payout state.
const PAYOUT_LABELS: Record<string, string> = {
  awaiting_funds: "On its way",
  funds_received: "On its way",
  in_review: "Being checked by Bridge",
  payment_submitted: "Sent to your bank",
  payment_processed: "Arrived",
  returned: "Returned to the wallet",
  refund_in_flight: "Being returned to the wallet",
  refunded: "Returned to the wallet",
  canceled: "Canceled",
  undeliverable: "Your bank refused it",
  refund_failed: "Didn't go through. Contact support.",
  error: "Didn't go through. Contact support.",
};
export function bankPayoutLabel(bank: unknown): string | null {
  if (!bank || typeof bank !== "object") return null;
  const state = (bank as { state?: unknown }).state;
  return typeof state === "string" ? (PAYOUT_LABELS[state] ?? "On its way") : null;
}

// --- Verifying with Bridge, once per account -------------------------------------------

// Shown until Bridge has approved the owner: start, finish, or why not.
function BankVerify({ bank }: { bank: BankStatus }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: async () => {
      // Opened right away, so the browser doesn't block it as a pop-up.
      const tab = window.open("about:blank", "_blank");
      try {
        const result = await api.startBankVerification();
        if (result.link && tab) {
          tab.opener = null;
          tab.location.href = result.link;
        } else tab?.close();
        return result;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
    onSuccess: (result) => queryClient.setQueryData(queryKeys.bank, result),
  });

  if (bank.status === "rejected") {
    return (
      <Notice tone="danger">
        Bridge couldn't verify you{bank.rejection ? `: ${bank.rejection}` : "."} Bank transfers
        aren't available, but you can still add and withdraw crypto.
      </Notice>
    );
  }
  if (bank.status === "pending" && bank.link) {
    return (
      <div className="grid gap-3 text-center">
        <Button asChild size="lg" className="h-12 rounded-full">
          <a href={bank.link} target="_blank" rel="noopener noreferrer">
            Finish with Bridge <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <Muted>This page updates by itself once Bridge approves you, usually within minutes.</Muted>
      </div>
    );
  }
  return (
    <div className="grid gap-3 text-center">
      <Muted>
        Verify once to use your bank: Bridge, a Stripe company, checks your ID and a selfie. The
        same check lets you send and withdraw.
      </Muted>
      <Button
        size="lg"
        className="h-12 rounded-full"
        disabled={start.isPending}
        onClick={() => start.mutate()}
      >
        {start.isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Landmark aria-hidden="true" />
        )}
        Verify my identity
      </Button>
      {start.isError && <Notice tone="danger">{errorMessage(start.error)}</Notice>}
    </div>
  );
}

// Loads the owner's bank status and shows verification until it's approved.
function WithBank({ children }: { children: (bank: BankStatus) => ReactNode }) {
  const bank = useBank();
  if (bank.isPending) return <LoadingRows rows={3} />;
  if (bank.isError) return <ErrorState error={bank.error} onRetry={() => void bank.refetch()} />;
  if (!bank.data.available) return <Muted>Bank transfers aren't available yet.</Muted>;
  if (bank.data.status !== "approved") return <BankVerify bank={bank.data} />;
  return <>{children(bank.data)}</>;
}

// --- Adding money by bank transfer -------------------------------------------------------

export function BankDeposit({ agent }: { agent: Agent }) {
  return (
    <WithBank>{(bank) => <DepositDetails agent={agent} currencies={bank.currencies} />}</WithBank>
  );
}

function DepositDetails({ agent, currencies }: { agent: Agent; currencies: BankCurrency[] }) {
  const [currency, setCurrency] = useState<BankCurrency>(currencies[0] ?? "usd");
  // The wallet's own deposit details, made the first time they're asked for.
  const deposit = useQuery({
    queryKey: [...queryKeys.agent(agent.id), "bank-deposit", currency],
    queryFn: async () => (await api.bankDeposit(agent.id, currency)).deposit,
    retry: shouldRetry,
    staleTime: Infinity,
  });

  if (!currencies.length) return <Muted>Bridge hasn't opened bank deposits for you yet.</Muted>;
  return (
    <div className="grid gap-5">
      {currencies.length > 1 && (
        <Segmented
          label="Currency"
          value={currency}
          onChange={setCurrency}
          options={currencies.map((c) => ({ value: c, label: CURRENCY_LABELS[c] }))}
          className="justify-self-center"
        />
      )}
      {deposit.isPending ? (
        <LoadingRows rows={4} />
      ) : deposit.isError ? (
        <ErrorState error={deposit.error} onRetry={() => void deposit.refetch()} />
      ) : (
        <DepositRows deposit={deposit.data} />
      )}
    </div>
  );
}

function DepositRows({ deposit }: { deposit: Deposit }) {
  const rows = [
    ["Name", deposit.beneficiary],
    ["IBAN", deposit.iban],
    ["BIC", deposit.bic],
    ["Account number", deposit.accountNumber],
    ["Routing number", deposit.routingNumber],
    ["Bank", deposit.bankName],
    ["Bank address", deposit.bankAddress],
    ["Reference", deposit.reference],
  ].filter((row): row is [string, string] => !!row[1]);
  const how =
    deposit.currency === "eur"
      ? "a SEPA transfer in euros"
      : "an ACH or wire transfer in US dollars";
  return (
    <div className="grid gap-4">
      <p className="text-center text-sm">
        Send {how} from your bank to these details. It arrives in this wallet as USDC.
      </p>
      <dl className="aid-card divide-y divide-[var(--border)] overflow-hidden">
        {rows.map(([term, value]) => (
          <div key={term} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-[var(--muted-foreground)]">{term}</dt>
              <dd className="aid-mono break-all text-sm">{value}</dd>
            </div>
            <CopyButton
              text={value}
              label={`Copy ${term.toLowerCase()}`}
              toastText={`${term} copied`}
              variant="ghost"
              iconOnly
            />
          </div>
        ))}
      </dl>
      <Muted className="text-center">
        {deposit.reference ? "Include the reference, or the money can't be matched. " : ""}
        Bridge converts it at its rate, usually within one business day.
      </Muted>
    </div>
  );
}

// --- Withdrawing to a bank account -------------------------------------------------------

export function BankWithdraw({
  agent,
  balance,
  onDone,
}: {
  agent: Agent;
  balance: Money | null;
  onDone: () => void;
}) {
  return (
    <WithBank>
      {(bank) => <BankWithdrawForm agent={agent} balance={balance} bank={bank} onDone={onDone} />}
    </WithBank>
  );
}

function BankWithdrawForm({
  agent,
  balance,
  bank,
  onDone,
}: {
  agent: Agent;
  balance: Money | null;
  bank: BankStatus;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string | null>(bank.accounts[0]?.id ?? null);
  const [adding, setAdding] = useState(bank.accounts.length === 0);
  const refresh = useRefreshAgent();
  const cents = parseAmount(amount);
  const value = amountValue(amount);
  const tooMuch = cents !== null && balance !== null && cents > balance.amount;
  const account = bank.accounts.find((a) => a.id === accountId) ?? null;

  const withdraw = useMutation({
    mutationFn: () => api.withdraw(agent.id, { bankAccount: accountId ?? "", value: value ?? "" }),
    onSuccess: async () => {
      toast.success(
        `${formatUsd(cents)} is on its way to ${account ? bankAccountLabel(account) : "your bank"}`,
      );
      onDone();
      await refresh(agent.id, { events: true });
    },
  });

  if (adding) {
    return (
      <AddBankAccount
        currencies={bank.currencies}
        onCancel={bank.accounts.length ? () => setAdding(false) : undefined}
        onAdded={(added) => {
          setAccountId(added.id);
          setAdding(false);
        }}
      />
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (account && value && !tooMuch && !withdraw.isPending) withdraw.mutate();
      }}
    >
      <div className="py-4 text-center">
        <AmountField id="bank-withdraw-amount" value={amount} onChange={setAmount} autoFocus />
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
      <div
        role="radiogroup"
        aria-label="To"
        className="aid-card divide-y divide-[var(--border)] overflow-hidden"
      >
        {bank.accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            selected={a.id === accountId}
            onSelect={() => setAccountId(a.id)}
          />
        ))}
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-[var(--muted)]/60"
          onClick={() => setAdding(true)}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--muted)]">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </span>
          Add bank account
        </button>
      </div>
      {account?.currency === "eur" && (
        <Muted className="text-center">Paid out in euros at Bridge's rate.</Muted>
      )}
      {withdraw.isError && <Notice tone="danger">{errorMessage(withdraw.error)}</Notice>}
      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-full"
        disabled={!account || !value || tooMuch || withdraw.isPending}
      >
        {withdraw.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Withdraw{value ? ` ${formatUsd(cents)}` : ""}
      </Button>
      <Muted className="text-center">Usually arrives in 1–2 business days.</Muted>
    </form>
  );
}

function AccountRow({
  account,
  selected,
  onSelect,
}: {
  account: BankAccount;
  selected: boolean;
  onSelect: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.removeBankAccount(account.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.bank }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", selected && "bg-[var(--accent)]")}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--muted)]">
          <Landmark className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{bankAccountLabel(account)}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">
            {account.currency.toUpperCase()} · {RAIL_LABELS[account.rail]}
          </span>
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={`Remove ${bankAccountLabel(account)}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

// --- Adding a bank account: an IBAN (euros) or a US account (dollars) --------------------

function AddBankAccount({
  currencies,
  onAdded,
  onCancel,
}: {
  currencies: BankCurrency[];
  onAdded: (account: BankAccount) => void;
  onCancel?: (() => void) | undefined;
}) {
  const kinds = [
    ...(currencies.includes("eur") ? [{ value: "iban" as const, label: "IBAN (Europe)" }] : []),
    ...(currencies.includes("usd") ? [{ value: "us" as const, label: "US account" }] : []),
  ];
  const [kind, setKind] = useState<"iban" | "us">(kinds[0]?.value ?? "iban");
  const [form, setForm] = useState({
    ownerName: "",
    iban: "",
    bic: "",
    accountNumber: "",
    routingNumber: "",
    checkingOrSavings: "checking" as "checking" | "savings",
    line1: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const queryClient = useQueryClient();

  const address = {
    line1: form.line1.trim(),
    city: form.city.trim(),
    postalCode: form.postalCode.trim(),
  };
  const input = (): NewBankAccount =>
    kind === "iban"
      ? {
          kind,
          ownerName: form.ownerName.trim(),
          iban: form.iban.replace(/\s+/g, ""),
          ...(form.bic.trim() ? { bic: form.bic.trim() } : {}),
          address,
        }
      : {
          kind,
          ownerName: form.ownerName.trim(),
          accountNumber: form.accountNumber.trim(),
          routingNumber: form.routingNumber.trim(),
          checkingOrSavings: form.checkingOrSavings,
          address: { ...address, state: form.state.trim() },
        };
  const complete =
    form.ownerName.trim().includes(" ") &&
    address.line1.length >= 4 &&
    !!address.city &&
    !!address.postalCode &&
    (kind === "iban"
      ? form.iban.replace(/\s+/g, "").length >= 15
      : /^\d{9}$/.test(form.routingNumber.trim()) &&
        /^\d{4,17}$/.test(form.accountNumber.trim()) &&
        !!form.state.trim());

  const add = useMutation({
    mutationFn: () => api.addBankAccount(input()),
    onSuccess: async ({ account }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bank });
      toast.success(`${bankAccountLabel(account)} added`);
      onAdded(account);
    },
  });

  if (!kinds.length) return <Muted>Bridge hasn't opened payouts for you yet.</Muted>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (complete && !add.isPending) add.mutate();
      }}
    >
      {kinds.length > 1 && (
        <Segmented
          label="Account type"
          value={kind}
          onChange={setKind}
          options={kinds}
          className="justify-self-start"
        />
      )}
      <Field id="bank-owner" label="Account holder" hint="Your name as your bank has it.">
        <Input
          id="bank-owner"
          autoComplete="name"
          value={form.ownerName}
          onChange={set("ownerName")}
          autoFocus
        />
      </Field>
      {kind === "iban" ? (
        <>
          <Field id="bank-iban" label="IBAN">
            <Input
              id="bank-iban"
              autoComplete="off"
              spellCheck={false}
              className="aid-mono"
              placeholder="SE45 5000 0000 0583 9825 7466"
              value={form.iban}
              onChange={set("iban")}
            />
          </Field>
          <Field id="bank-bic" label="BIC" hint="Optional.">
            <Input
              id="bank-bic"
              autoComplete="off"
              spellCheck={false}
              className="aid-mono"
              value={form.bic}
              onChange={set("bic")}
            />
          </Field>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bank-routing" label="Routing number">
              <Input
                id="bank-routing"
                inputMode="numeric"
                autoComplete="off"
                className="aid-mono"
                value={form.routingNumber}
                onChange={set("routingNumber")}
              />
            </Field>
            <Field id="bank-account" label="Account number">
              <Input
                id="bank-account"
                inputMode="numeric"
                autoComplete="off"
                className="aid-mono"
                value={form.accountNumber}
                onChange={set("accountNumber")}
              />
            </Field>
          </div>
          <Segmented
            label="Account kind"
            value={form.checkingOrSavings}
            onChange={(v) => setForm((f) => ({ ...f, checkingOrSavings: v }))}
            options={[
              { value: "checking", label: "Checking" },
              { value: "savings", label: "Savings" },
            ]}
            className="justify-self-start"
          />
        </>
      )}
      <Field id="bank-line1" label="Your address">
        <Input
          id="bank-line1"
          autoComplete="address-line1"
          placeholder="Street and number"
          maxLength={35}
          value={form.line1}
          onChange={set("line1")}
        />
      </Field>
      <div className={cn("grid gap-3", kind === "us" ? "grid-cols-3" : "grid-cols-2")}>
        <Input
          aria-label="City"
          autoComplete="address-level2"
          placeholder="City"
          value={form.city}
          onChange={set("city")}
        />
        {kind === "us" && (
          <Input
            aria-label="State"
            autoComplete="address-level1"
            placeholder="State"
            value={form.state}
            onChange={set("state")}
          />
        )}
        <Input
          aria-label="Postal code"
          autoComplete="postal-code"
          placeholder={kind === "us" ? "ZIP" : "Postal code"}
          value={form.postalCode}
          onChange={set("postalCode")}
        />
      </div>
      {add.isError && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-full"
        disabled={!complete || add.isPending}
      >
        {add.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Add bank account
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
      )}
    </form>
  );
}
