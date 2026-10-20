// The agent's wallet, like a bank account: a dollar balance, Send and Add
// money, and its transactions. Live wallets hold USDC and USDT 1:1.
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus, Send, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/agent-id/client";
import {
  amountValue,
  counterpartyLabel,
  formatDate,
  formatUsd,
  parseAmount,
} from "@/lib/agent-id/format";
import { qrPath } from "@/lib/agent-id/qr";
import {
  queryKeys,
  useAgents,
  useApprovals,
  useContacts,
  useEventPages,
  useRefreshAgent,
  useWalletSummary,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentEvent } from "@/lib/agent-id/types";
import {
  CopyButton,
  Empty,
  ErrorState,
  EventStatus,
  Field,
  LoadingRows,
  Muted,
  Notice,
  Row,
  Rows,
  Section,
  SidePanel,
} from "../ui";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";
import { LimitsEditor } from "./LimitsEditor";

const NETWORK_LABELS: Record<string, string> = {
  base: "Base",
  "base-sepolia": "Base Sepolia (testnet)",
  base_sepolia: "Base Sepolia (testnet)",
};

export function WalletTab({ agent }: { agent: Agent }) {
  const wallet = agent.resources.wallet;
  const blocked = blockedReason(agent, wallet);
  const summary = useWalletSummary(agent.id, !!wallet && !blocked);
  const pages = useEventPages(agent.id, { kind: ["wallet"] }, { enabled: !!wallet });
  const approvals = useApprovals();

  if (!wallet) return <NoResource agent={agent} kind="wallet" />;

  const balance = summary.data?.balance ?? wallet.balance ?? null;
  const test = wallet.mode === "test";
  const events = pages.data?.pages.flatMap((p) => p.events) ?? [];
  const waiting = (approvals.data ?? []).filter((a) => a.agentId === agent.id).length;

  return (
    <div className="space-y-6">
      <BlockedNotice reason={blocked} />

      <section className="aid-card p-6">
        <p className="aid-label">Balance</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          {balance ? formatUsd(balance.amount) : summary.isPending && !blocked ? "…" : "—"}
        </p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {test ? "Test dollars, for trying things out" : "USD · backed 1:1 by USDC and USDT"}
        </p>
        {summary.data?.balanceError && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">{summary.data.balanceError}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <SendMoney agent={agent} disabled={!!blocked} />
          <AddMoney
            agent={agent}
            address={summary.data?.address ?? wallet.address}
            network={summary.data?.network ?? wallet.details.network}
          />
          <LimitsPanel agent={agent} />
        </div>
      </section>

      {waiting > 0 && (
        <Notice tone="warning">
          {waiting} transfer{waiting === 1 ? " is" : "s are"} waiting for your approval.{" "}
          <Link to="/agent-id/approvals" className="font-medium underline">
            Review
          </Link>
        </Notice>
      )}

      <Section title="Transactions" flush>
        {pages.isPending ? (
          <LoadingRows rows={4} />
        ) : pages.isError ? (
          <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
        ) : events.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          <>
            <Rows label="Transactions">
              {events.map((e) => (
                <Transaction key={e.id} event={e} />
              ))}
            </Rows>
            <LoadMore
              hasMore={pages.hasNextPage}
              loading={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            />
          </>
        )}
      </Section>
    </div>
  );
}

function Transaction({ event }: { event: AgentEvent }) {
  const incoming = event.direction === "in";
  const explorer = typeof event.data["explorer"] === "string" ? event.data["explorer"] : null;
  const asset = typeof event.data["asset"] === "string" ? event.data["asset"] : null;
  return (
    <Row>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            incoming
              ? "bg-[var(--aid-success-bg)] text-[var(--aid-success)]"
              : "bg-[var(--muted)] text-[var(--foreground)]",
          )}
        >
          {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={event.counterparty ?? undefined}>
            {incoming ? "From " : "To "}
            {counterpartyLabel(event.counterparty)}
          </p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {event.subject ? `${event.subject} · ` : ""}
            {formatDate(event.at)}
            {asset ? ` · ${asset}` : ""}
            {explorer && (
              <>
                {" · "}
                <a href={explorer} target="_blank" rel="noreferrer noopener" className="aid-link">
                  Receipt
                </a>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {(event.status === "pending" || event.status === "failed") && (
          <EventStatus status={event.status} />
        )}
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            incoming && "text-[var(--aid-success)]",
            event.status === "failed" && "text-[var(--muted-foreground)] line-through",
          )}
        >
          {incoming ? "+" : "−"}
          {formatUsd(event.amount?.amount)}
        </span>
      </div>
    </Row>
  );
}

function SendMoney({ agent, disabled }: { agent: Agent; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const agents = useAgents();
  const contacts = useContacts(agent.id);
  const refresh = useRefreshAgent();
  const queryClient = useQueryClient();
  const wallet = agent.resources.wallet;
  const value = amountValue(amount);
  const cents = parseAmount(amount);
  const approvalAbove = wallet?.settings.approvalAbove;
  const suggestions = [
    ...(agents.data ?? [])
      .filter((a) => a.id !== agent.id && a.resources.wallet?.mode === wallet?.mode)
      .map((a) => ({ value: a.handle, label: a.name })),
    ...(contacts.data ?? [])
      .filter((c) => c.wallet)
      .map((c) => ({ value: c.name, label: c.wallet ?? "" })),
  ];

  const send = useMutation({
    mutationFn: () =>
      api.asAgent(agent.id).sendMoney({
        to: to.trim(),
        value: value ?? "",
        ...(note.trim() ? { memo: note.trim() } : {}),
      }),
    onSuccess: async (result) => {
      if (result.status === "needs_approval") toast.info("Waiting for your approval");
      else toast.success(`Sent ${formatUsd(result.transfer.amount?.amount)}`);
      setOpen(false);
      setAmount("");
      setNote("");
      await Promise.all([
        refresh(agent.id, { events: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "me"] }),
      ]);
    },
  });

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) send.reset();
      }}
      title="Send money"
      trigger={
        <Button disabled={disabled}>
          <Send aria-hidden="true" /> Send
        </Button>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (to.trim() && value) send.mutate();
        }}
      >
        <Field
          id="send-amount"
          label="Amount"
          error={amount.trim() && !value ? "Like 12.50" : null}
        >
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-2xl text-[var(--muted-foreground)]">
              $
            </span>
            <Input
              id="send-amount"
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              className="h-14 pl-8 text-2xl font-semibold"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </Field>
        <Field id="send-to" label="To" hint="An agent, a contact, or a wallet address.">
          <Input
            id="send-to"
            list="send-suggestions"
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <datalist id="send-suggestions">
            {suggestions.map((s) => (
              <option key={`${s.value}-${s.label}`} value={s.value}>
                {s.label}
              </option>
            ))}
          </datalist>
        </Field>
        <Field id="send-note" label="Note">
          <Input
            id="send-note"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {typeof approvalAbove === "number" && cents !== null && cents > approvalAbove && (
          <Muted>Over {formatUsd(approvalAbove)}, so you'll approve it first.</Muted>
        )}
        {send.isError && <Notice tone="danger">{errorMessage(send.error)}</Notice>}
        <Button type="submit" size="lg" disabled={!to.trim() || !value || send.isPending}>
          {send.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Send {value ? formatUsd(cents) : ""}
        </Button>
      </form>
    </SidePanel>
  );
}

function AddMoney({
  agent,
  address,
  network,
}: {
  agent: Agent;
  address: string | null | undefined;
  network: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const test = agent.resources.wallet?.mode === "test";
  return (
    <SidePanel
      open={open}
      onOpenChange={setOpen}
      title={test ? "Add test money" : "Add money"}
      trigger={
        <Button variant="outline" disabled={agent.status === "revoked"}>
          <Plus aria-hidden="true" /> Add money
        </Button>
      }
    >
      {test ? (
        <TestMoney agent={agent} onDone={() => setOpen(false)} />
      ) : address ? (
        <div className="grid justify-items-center gap-5 text-center">
          <QrCode value={address} />
          <p className="text-sm">
            Send USDC or USDT on {NETWORK_LABELS[network ?? ""] ?? "Base"} to this address.
          </p>
          <div className="w-full">
            <p className="aid-mono break-all rounded-lg bg-[var(--muted)] px-3 py-2 text-sm">
              {address}
            </p>
            <div className="mt-2 flex justify-center">
              <CopyButton
                text={address}
                label="Copy address"
                toastText="Address copied"
                variant="default"
              />
            </div>
          </div>
        </div>
      ) : (
        <Muted>The wallet has no address yet.</Muted>
      )}
    </SidePanel>
  );
}

function QrCode({ value }: { value: string }) {
  const { size, path } = qrPath(value);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code of the wallet address"
      className="h-52 w-52 rounded-xl border border-[var(--border)]"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#172033" />
    </svg>
  );
}

function TestMoney({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const [amount, setAmount] = useState("100.00");
  const refresh = useRefreshAgent();
  const cents = parseAmount(amount);
  const tooMuch = cents !== null && cents > 100000;
  const add = useMutation({
    mutationFn: () => api.addTestFunds(agent.id, cents ?? 0),
    onSuccess: async (result) => {
      toast.success(`Balance ${formatUsd(result.balance.amount)}`);
      onDone();
      await refresh(agent.id, { events: true });
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (cents && !tooMuch) add.mutate();
      }}
    >
      <Field
        id="test-funds"
        label="Amount"
        error={
          amount.trim() && !cents ? "Like 100.00" : tooMuch ? "At most $1,000 at a time" : null
        }
      >
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-2xl text-[var(--muted-foreground)]">
            $
          </span>
          <Input
            id="test-funds"
            inputMode="decimal"
            className="h-14 pl-8 text-2xl font-semibold"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </Field>
      {add.isError && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
      <Button type="submit" size="lg" disabled={!cents || tooMuch || add.isPending}>
        {add.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Add test money
      </Button>
    </form>
  );
}

function LimitsPanel({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const wallet = agent.resources.wallet!;
  return (
    <SidePanel
      open={open}
      onOpenChange={setOpen}
      title="Spending limits"
      trigger={
        <Button variant="ghost">
          <SlidersHorizontal aria-hidden="true" /> Spending limits
        </Button>
      }
    >
      <LimitsEditor
        bare
        agent={agent}
        kind="wallet"
        settings={wallet.settings}
        currency="USD"
        fields={[
          { key: "perTransfer", label: "Most per transfer" },
          { key: "daily", label: "Most per day" },
          { key: "approvalAbove", label: "Ask me above" },
        ]}
      />
    </SidePanel>
  );
}
