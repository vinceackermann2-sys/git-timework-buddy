// The agent's wallet, like a modern bank app: a dollar balance, round quick
// actions, and transactions by day. Live wallets hold USDC and USDT 1:1.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  ExternalLink,
  Info,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/agent-id/client";
import {
  amountValue,
  counterpartyLabel,
  eventStatusLabel,
  formatDateTime,
  formatTime,
  formatUsd,
  groupByDay,
  parseAmount,
  shortAddress,
} from "@/lib/agent-id/format";
import {
  queryKeys,
  useAgents,
  useApprovals,
  useContacts,
  useEventPages,
  useRefreshAgent,
  useTestMode,
  useWalletSummary,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentEvent, WalletSummary } from "@/lib/agent-id/types";
import {
  Avatar,
  Chip,
  CopyButton,
  ErrorState,
  Field,
  LoadingRows,
  Muted,
  Notice,
  SidePanel,
} from "../ui";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";
import { AddMoney, AmountField, Withdraw } from "./WalletMoney";
import { LimitsEditor } from "./LimitsEditor";

const NETWORK_LABELS: Record<string, string> = {
  base: "Base",
  "base-sepolia": "Base Sepolia (testnet)",
  base_sepolia: "Base Sepolia (testnet)",
  test: "Test",
};

export function WalletTab({ agent }: { agent: Agent }) {
  const wallet = agent.resources.wallet;
  const blocked = blockedReason(agent, wallet);
  const summary = useWalletSummary(agent.id, !!wallet && !blocked);
  const pages = useEventPages(agent.id, { kind: ["wallet"] }, { enabled: !!wallet });
  const approvals = useApprovals();
  const [panel, setPanel] = useState<"add" | "send" | "withdraw" | "details" | null>(null);
  const [openTx, setOpenTx] = useState<AgentEvent | null>(null);
  const testMode = useTestMode();

  if (!wallet) return <NoResource agent={agent} kind="wallet" />;

  const balance = summary.data?.balance ?? wallet.balance ?? null;
  const test = wallet.mode === "test";
  const events = pages.data?.pages.flatMap((p) => p.events) ?? [];
  const waiting = (approvals.data ?? []).filter((a) => a.agentId === agent.id).length;
  const network = summary.data?.network ?? wallet.details.network;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BlockedNotice reason={blocked} />

      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#f6ecff] via-[#efe0ff] to-[#e3ccff] p-6 text-[#172033] shadow-[0_1px_2px_rgba(23,32,51,0.06)] sm:p-8">
        <p className="text-sm font-medium text-[#172033]/70">Balance</p>
        <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
          {balance ? formatUsd(balance.amount) : summary.isPending && !blocked ? "…" : "—"}
        </p>
        <p className="mt-2 text-sm text-[#172033]/70">
          {test ? "Test dollars" : "USD · backed 1:1 by USDC and USDT"}
        </p>
        {summary.data?.balanceError && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">{summary.data.balanceError}</p>
        )}
        <div className="mt-7 flex gap-5 sm:gap-6">
          <QuickAction
            label="Add money"
            icon={<Plus className="h-5 w-5" />}
            // Test money only exists while the service runs in test mode.
            disabled={agent.status === "revoked" || (test && !testMode)}
            onClick={() => setPanel("add")}
          />
          <QuickAction
            label="Send"
            icon={<ArrowUpRight className="h-5 w-5" />}
            disabled={!!blocked}
            onClick={() => setPanel("send")}
          />
          {!test && (
            <QuickAction
              label="Withdraw"
              icon={<ArrowDownToLine className="h-5 w-5" />}
              disabled={agent.status === "revoked" || wallet.status !== "active"}
              onClick={() => setPanel("withdraw")}
            />
          )}
          <QuickAction
            label="Details"
            icon={<Info className="h-5 w-5" />}
            onClick={() => setPanel("details")}
          />
        </div>
      </section>

      {waiting > 0 && (
        <Notice tone="warning">
          {waiting} payment{waiting === 1 ? " is" : "s are"} waiting for your approval.{" "}
          <Link to="/agent-id/approvals" className="font-medium underline">
            Review
          </Link>
        </Notice>
      )}

      <section aria-label="Transactions">
        <h3 className="mb-2 px-1 text-lg font-semibold">Transactions</h3>
        <div className="aid-card overflow-hidden">
          {pages.isPending ? (
            <LoadingRows rows={4} />
          ) : pages.isError ? (
            <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
          ) : events.length === 0 ? (
            <p className="px-5 py-14 text-center text-sm text-[var(--muted-foreground)]">
              No transactions yet
            </p>
          ) : (
            <>
              {groupByDay(events).map((group) => (
                <div key={group.day}>
                  <p className="bg-[var(--muted)]/60 px-5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]">
                    {group.day}
                  </p>
                  <ul>
                    {group.items.map((e) => (
                      <TransactionRow key={e.id} event={e} onOpen={() => setOpenTx(e)} />
                    ))}
                  </ul>
                </div>
              ))}
              <LoadMore
                hasMore={pages.hasNextPage}
                loading={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              />
            </>
          )}
        </div>
      </section>

      <SidePanel
        open={panel === "send"}
        onOpenChange={(open) => setPanel(open ? "send" : null)}
        title="Send"
        trigger={<span className="hidden" />}
      >
        <SendForm agent={agent} onDone={() => setPanel(null)} />
      </SidePanel>
      <SidePanel
        open={panel === "add"}
        onOpenChange={(open) => setPanel(open ? "add" : null)}
        title={test ? "Add test money" : "Add money"}
        trigger={<span className="hidden" />}
      >
        {test ? (
          <TestMoney agent={agent} onDone={() => setPanel(null)} />
        ) : (
          <AddMoney agent={agent} />
        )}
      </SidePanel>
      {!test && (
        <SidePanel
          open={panel === "withdraw"}
          onOpenChange={(open) => setPanel(open ? "withdraw" : null)}
          title="Withdraw"
          trigger={<span className="hidden" />}
        >
          <Withdraw agent={agent} balance={balance} onDone={() => setPanel(null)} />
        </SidePanel>
      )}
      <SidePanel
        open={panel === "details"}
        onOpenChange={(open) => setPanel(open ? "details" : null)}
        title="Wallet details"
        trigger={<span className="hidden" />}
      >
        <Details agent={agent} summary={summary.data} network={network} />
      </SidePanel>
      <SidePanel
        open={!!openTx}
        onOpenChange={(open) => !open && setOpenTx(null)}
        title="Transaction"
        trigger={<span className="hidden" />}
      >
        {openTx && <TransactionDetail event={openTx} network={network} />}
      </SidePanel>
    </div>
  );
}

function QuickAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center gap-2 text-xs font-medium text-[#172033] disabled:opacity-40"
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/80 shadow-sm transition group-hover:bg-white group-active:scale-95">
        {icon}
      </span>
      {label}
    </button>
  );
}

const isIn = (e: AgentEvent) => e.direction === "in";

function TransactionRow({ event, onOpen }: { event: AgentEvent; onOpen: () => void }) {
  const name = counterpartyLabel(event.counterparty);
  const deposit = isIn(event) && (name === "Test funds" || /^0x/i.test(name));
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 border-b border-[var(--border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--muted)]/60"
      >
        {deposit ? (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--aid-success-bg)] text-[var(--aid-success)]">
            <ArrowDownLeft className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : (
          <Avatar name={name} size="md" colorful />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {deposit ? "Money added" : name}
          </span>
          <span className="block truncate text-xs text-[var(--muted-foreground)]">
            {event.subject || (isIn(event) ? "Received" : "Sent")} · {formatTime(event.at)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "text-[15px] font-semibold tabular-nums",
              isIn(event) && "text-[var(--aid-success)]",
              event.status === "failed" && "text-[var(--muted-foreground)] line-through",
            )}
          >
            {isIn(event) ? "+" : "−"}
            {formatUsd(event.amount?.amount)}
          </span>
          {event.status !== "completed" && (
            <Chip tone={event.status === "failed" ? "danger" : "warning"}>
              {eventStatusLabel(event.status)}
            </Chip>
          )}
        </span>
      </button>
    </li>
  );
}

function TransactionDetail({ event, network }: { event: AgentEvent; network: string | undefined }) {
  const explorer = typeof event.data["explorer"] === "string" ? event.data["explorer"] : null;
  const asset = typeof event.data["asset"] === "string" ? event.data["asset"] : null;
  const name = counterpartyLabel(event.counterparty);
  return (
    <div className="flex flex-col items-center text-center">
      <Avatar name={name} size="lg" colorful />
      <p
        className={cn(
          "mt-4 text-4xl font-semibold tracking-tight tabular-nums",
          isIn(event) && "text-[var(--aid-success)]",
        )}
      >
        {isIn(event) ? "+" : "−"}
        {formatUsd(event.amount?.amount)}
      </p>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        {isIn(event) ? "From" : "To"} {name}
      </p>
      <dl className="mt-6 w-full divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] text-left text-sm">
        <Row term="Status" value={eventStatusLabel(event.status)} />
        <Row term="Date" value={formatDateTime(event.at)} />
        {event.subject && <Row term="Note" value={event.subject} />}
        <Row
          term={isIn(event) ? "From" : "To"}
          value={<span className="aid-mono break-all text-xs">{event.counterparty}</span>}
        />
        {asset && <Row term="Paid in" value={asset.toUpperCase()} />}
        {network && <Row term="Network" value={NETWORK_LABELS[network] ?? network} />}
      </dl>
      {explorer && (
        <Button asChild variant="outline" className="mt-5 rounded-full">
          <a href={explorer} target="_blank" rel="noreferrer noopener">
            View on Basescan <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-[var(--muted-foreground)]">{term}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}

function SendForm({ agent, onDone }: { agent: Agent; onDone: () => void }) {
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
      onDone();
      await Promise.all([
        refresh(agent.id, { events: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "events"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-id", "me"] }),
      ]);
    },
  });

  return (
    <form
      className="grid gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (to.trim() && value) send.mutate();
      }}
    >
      <div className="py-4 text-center">
        <AmountField id="send-amount" value={amount} onChange={setAmount} autoFocus />
        {amount.trim() && !value && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">Enter an amount like 12.50</p>
        )}
      </div>
      <Field id="send-to" label="To">
        <Input
          id="send-to"
          list="send-suggestions"
          autoComplete="off"
          placeholder="Agent, contact or wallet address"
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
      <Field id="send-note" label="What's it for?">
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
      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-full"
        disabled={!to.trim() || !value || send.isPending}
      >
        {send.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Send{value ? ` ${formatUsd(cents)}` : ""}
      </Button>
    </form>
  );
}

function Details({
  agent,
  summary,
  network,
}: {
  agent: Agent;
  summary: WalletSummary | undefined;
  network: string | undefined;
}) {
  const wallet = agent.resources.wallet!;
  const testMode = useTestMode();
  const address = summary?.address ?? wallet.address;
  return (
    <div className="space-y-6">
      <dl className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] text-sm">
        {address && (
          <Row
            term="Address"
            value={
              <span className="flex items-center justify-end gap-1">
                <span className="aid-mono break-all text-xs">{address}</span>
                <CopyButton text={address} iconOnly variant="ghost" label="Copy address" />
              </span>
            }
          />
        )}
        {network && network !== "test" && (
          <Row term="Network" value={NETWORK_LABELS[network] ?? network} />
        )}
        {(summary?.assets ?? []).map((a) => (
          <Row key={a.asset} term={a.asset} value={formatUsd(a.amount)} />
        ))}
        {summary?.sent.last24Hours && (
          <Row term="Sent today" value={formatUsd(summary.sent.last24Hours.amount)} />
        )}
        {wallet.settings.withdrawTo && (
          <Row
            term="Withdraws to"
            value={
              <span className="aid-mono text-xs" title={wallet.settings.withdrawTo}>
                {shortAddress(wallet.settings.withdrawTo)}
              </span>
            }
          />
        )}
        {testMode && <Row term="Mode" value={wallet.mode === "test" ? "Test" : "Live"} />}
      </dl>
      <div>
        <h4 className="mb-3 text-sm font-semibold">Spending limits</h4>
        <LimitsEditor
          bare
          agent={agent}
          kind="wallet"
          settings={wallet.settings}
          currency="USD"
          fields={[
            { key: "perTransfer", label: "Most per payment" },
            { key: "daily", label: "Most per day" },
            { key: "approvalAbove", label: "Ask me above" },
          ]}
        />
      </div>
    </div>
  );
}

function TestMoney({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const [amount, setAmount] = useState("100");
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
      <div className="py-4 text-center">
        <AmountField id="test-funds" value={amount} onChange={setAmount} />
        {tooMuch && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">At most $1,000 at a time</p>
        )}
      </div>
      {add.isError && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-full"
        disabled={!cents || tooMuch || add.isPending}
      >
        {add.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Add test money
      </Button>
    </form>
  );
}
