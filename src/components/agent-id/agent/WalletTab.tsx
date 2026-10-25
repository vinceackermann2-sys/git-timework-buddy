// The agent's wallet, like a modern bank app: a dollar balance, round quick
// actions, and transactions by day. Live wallets hold USDC and USDT 1:1.
import { Suspense, lazy, useDeferredValue, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpRight,
  BadgeCheck,
  ExternalLink,
  Info,
  Landmark,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/agent-id/client";
import {
  amountValue,
  balanceHistory,
  balanceTrend,
  counterpartyLabel,
  eventStatusLabel,
  formatDateTime,
  formatTime,
  formatUsd,
  groupByDay,
  parseAmount,
  shortAddress,
  walletHolds,
} from "@/lib/agent-id/format";
import {
  queryKeys,
  useAccount,
  useAgent,
  useAgents,
  useApprovals,
  useContacts,
  useEventPages,
  useRefreshAgent,
  useTestMode,
  useWalletSummary,
} from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, AgentEvent, BankPayin, WalletSummary } from "@/lib/agent-id/types";
import {
  AgentAvatar,
  Avatar,
  Chip,
  CopyButton,
  Empty,
  ErrorState,
  Field,
  LoadingRows,
  Muted,
  Notice,
  Popup,
} from "../ui";
import { BlockedNotice, LoadMore, NoResource, blockedReason } from "./common";
import { AddMoney, AmountField, Withdraw } from "./WalletMoney";
import {
  PayinDetails,
  bankPayoutLabel,
  formatEur,
  payinOpen,
  payinStateLabel,
  usePayins,
} from "./BankMoney";
import { PendingApprovals } from "../ApprovalList";
import { useAgentIdTheme } from "../AgentIdShell";
import { LimitsEditor } from "./LimitsEditor";

// Privy's SDK is large: it loads only when someone pays by card.
const PrivyCardFlow = lazy(() => import("./PrivyCardPay"));

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
  const detail = useAgent(agent.id);
  const pages = useEventPages(agent.id, { kind: ["wallet"] }, { enabled: !!wallet });
  const approvals = useApprovals();
  const [panel, setPanel] = useState<"add" | "send" | "withdraw" | "details" | null>(null);
  const [openTx, setOpenTx] = useState<AgentEvent | null>(null);
  const [openPayin, setOpenPayin] = useState<string | null>(null);
  // A card payment through Privy: its app, and a number that starts each one.
  const [privy, setPrivy] = useState<{ appId: string; request: number } | null>(null);
  const { choice } = useAgentIdTheme();
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const testMode = useTestMode();
  const bankOn = useAccount().data?.config.bank?.available === true && wallet?.mode === "live";
  // SEPA transfers on their way in: shown above the transactions until they arrive.
  const payins = usePayins(agent.id, bankOn && !!wallet);

  if (!wallet) return <NoResource agent={agent} kind="wallet" />;

  const balance = summary.data?.balance ?? wallet.balance ?? null;
  const test = wallet.mode === "test";
  // Money comes in at once; it leaves a live wallet once the owner is verified.
  const mustVerify = !test && detail.data?.verification.verified === false;
  const events = pages.data?.pages.flatMap((p) => p.events) ?? [];
  const waiting = (approvals.data ?? []).filter((a) => a.agentId === agent.id);
  const network = summary.data?.network ?? wallet.details.network;
  const incoming = (payins.data ?? []).filter(payinOpen);
  const shownPayin = payins.data?.find((p) => p.id === openPayin) ?? null;
  // The last 30 days, walked back from the balance through the transfers loaded.
  const history = balanceHistory(balance?.amount ?? 0, pages.isPending ? [] : events, {
    complete: !pages.hasNextPage,
  });

  return (
    <div className="space-y-6">
      <BlockedNotice reason={blocked} />
      {mustVerify && <VerifyToMoveMoney />}

      <section aria-label="Balance" className="aid-card p-6 sm:p-8">
        <p className="text-sm font-medium text-[var(--muted-foreground)]">Balance</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">
            {balance ? formatUsd(balance.amount) : summary.isPending && !blocked ? "…" : "—"}
          </span>
          <span className="text-lg font-medium text-[var(--muted-foreground)]">
            {test ? "test USD" : "USD"}
          </span>
        </p>
        {summary.data?.balanceError && (
          <p className="mt-1 text-xs text-[var(--aid-danger)]">{summary.data.balanceError}</p>
        )}
        <BalanceChart points={history} />
        <div className="mt-7 flex justify-between gap-2 sm:justify-start sm:gap-8">
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
          <QuickAction
            label="Withdraw"
            icon={<ArrowDownToLine className="h-5 w-5" />}
            disabled={agent.status === "revoked" || wallet.status !== "active"}
            onClick={() => setPanel("withdraw")}
          />
          <QuickAction
            label="Details"
            icon={<Info className="h-5 w-5" />}
            onClick={() => setPanel("details")}
          />
        </div>
      </section>

      {waiting.length > 0 && (
        <section aria-label="Waiting for your approval" className="aid-card overflow-hidden">
          <PendingApprovals approvals={waiting} />
        </section>
      )}

      <section aria-label="Transactions">
        <h3 className="mb-2 px-1 text-lg font-semibold">Transactions</h3>
        <div className="aid-card overflow-hidden">
          {pages.isPending ? (
            <LoadingRows rows={4} />
          ) : pages.isError ? (
            <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
          ) : events.length === 0 && incoming.length === 0 ? (
            <Empty icon={ArrowLeftRight}>
              No transactions yet. Money in and out shows up here.
            </Empty>
          ) : (
            <>
              {incoming.length > 0 && (
                <ul aria-label="On the way">
                  {incoming.map((p) => (
                    <PayinRow key={p.id} payin={p} onOpen={() => setOpenPayin(p.id)} />
                  ))}
                </ul>
              )}
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

      <Popup
        open={panel === "send"}
        onOpenChange={(open) => setPanel(open ? "send" : null)}
        title="Send"
      >
        {mustVerify ? (
          <VerifyToMoveMoney inPanel />
        ) : (
          <SendForm agent={agent} onDone={() => setPanel(null)} />
        )}
      </Popup>
      <Popup
        open={panel === "add"}
        onOpenChange={(open) => setPanel(open ? "add" : null)}
        title={test ? "Add test money" : "Add money"}
      >
        {test ? (
          <TestMoney agent={agent} onDone={() => setPanel(null)} />
        ) : (
          <AddMoney
            agent={agent}
            onPrivyPay={(appId) => {
              // Privy's own windows take over from here.
              setPanel(null);
              setPrivy((current) => ({ appId, request: (current?.request ?? 0) + 1 }));
            }}
          />
        )}
      </Popup>
      <Popup
        open={panel === "withdraw"}
        onOpenChange={(open) => setPanel(open ? "withdraw" : null)}
        title={test ? "Withdraw test money" : "Withdraw"}
      >
        {mustVerify ? (
          <VerifyToMoveMoney inPanel />
        ) : (
          <Withdraw agent={agent} balance={balance} onDone={() => setPanel(null)} />
        )}
      </Popup>
      <Popup
        open={panel === "details"}
        onOpenChange={(open) => setPanel(open ? "details" : null)}
        title="Wallet details"
      >
        <Details agent={agent} summary={summary.data} network={network} />
      </Popup>
      <Popup
        open={!!shownPayin}
        onOpenChange={(open) => !open && setOpenPayin(null)}
        title="Bank transfer"
      >
        {shownPayin && (
          <PayinDetails agent={agent} payin={shownPayin} onBack={() => setOpenPayin(null)} />
        )}
      </Popup>
      <Popup open={!!openTx} onOpenChange={(open) => !open && setOpenTx(null)} title="Transaction">
        {openTx && <TransactionDetail event={openTx} network={network} />}
      </Popup>
      {privy && (
        <Suspense fallback={null}>
          <PrivyCardFlow agent={agent} appId={privy.appId} dark={dark} request={privy.request} />
        </Suspense>
      )}
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
      className="group flex flex-col items-center gap-2 text-xs font-medium disabled:opacity-40"
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--muted)] transition group-hover:bg-[var(--border)] group-active:scale-95">
        {icon}
      </span>
      {label}
    </button>
  );
}

// The balance over the last 30 days as a line: green when it went up, red when
// it went down, a grey dashed line when nothing changed.
function BalanceChart({ points }: { points: (number | null)[] }) {
  const id = useId().replace(/:/g, "");
  const trend = balanceTrend(points);
  const known = points.flatMap((p, i) => (p === null ? [] : [[i, p] as const]));
  const first = known[0]?.[1] ?? 0;
  const change = (known.at(-1)?.[1] ?? 0) - first;
  const color =
    trend === "up"
      ? "var(--aid-up)"
      : trend === "down"
        ? "var(--aid-down)"
        : "var(--muted-foreground)";
  const [W, H, PAD] = [300, 72, 6];
  const values = known.map(([, p]) => p);
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * W;
  const y = (v: number) =>
    max === min ? H / 2 : PAD + (H - 2 * PAD) * (1 - (v - min) / (max - min));
  const line =
    known.length < 2
      ? `M0 ${H / 2}H${W}`
      : known.map(([i, p], n) => `${n ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join("");
  const area =
    known.length < 2
      ? ""
      : `${line}L${x(known.at(-1)![0]).toFixed(1)} ${H}L${x(known[0]![0]).toFixed(1)} ${H}Z`;
  const said =
    trend === "flat"
      ? "No change in the last 30 days"
      : `${trend === "up" ? "Up" : "Down"} ${formatUsd(Math.abs(change))} in the last 30 days`;
  return (
    <div className="mt-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={said}
        className="h-20 w-full overflow-visible"
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: color, stopOpacity: 0.16 }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {trend !== "flat" && area && <path d={area} fill={`url(#${id}-fill)`} />}
        <path
          d={line}
          fill="none"
          style={{ stroke: color }}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={trend === "flat" ? "5 5" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="mt-2 flex justify-between text-xs text-[var(--muted-foreground)]">
        <span>Last 30 days</span>
        {trend !== "flat" && (
          <span className="font-medium tabular-nums" style={{ color }}>
            {trend === "up" ? "+" : "−"}
            {formatUsd(Math.abs(change))}
          </span>
        )}
      </p>
    </div>
  );
}

const isIn = (e: AgentEvent) => e.direction === "in";

// Before the owner's one identity check: what it unlocks, and the way to it.
function VerifyToMoveMoney({ inPanel = false }: { inPanel?: boolean }) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center",
        inPanel ? "py-2" : "aid-card px-5 py-4",
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--aid-ink)]">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Verify once to send and withdraw</p>
        <p className="text-sm text-[var(--muted-foreground)]">
          Money can already come in. A two-minute check of your ID unlocks sending and withdrawing.
        </p>
      </div>
      <Button asChild className={cn(inPanel && "w-full")}>
        <Link to="/agent-id/verify">Verify</Link>
      </Button>
    </section>
  );
}

// A SEPA transfer on its way in: the amount in euros, and where it is.
function PayinRow({ payin, onOpen }: { payin: BankPayin; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 border-b border-[var(--border)] px-5 py-3 text-left transition-colors hover:bg-[var(--muted)]/60"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">Bank transfer</span>
          <span className="block truncate text-xs text-[var(--muted-foreground)]">
            {payinStateLabel(payin.state)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[15px] font-semibold tabular-nums text-[var(--muted-foreground)]">
            +{formatEur(payin.amount)}
          </span>
          <Chip tone="warning">{payin.state === "awaiting_funds" ? "Waiting" : "On its way"}</Chip>
        </span>
      </button>
    </li>
  );
}

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
  const bank = bankPayoutLabel(event.data["bank"]);
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
        {bank && <Row term="Bank" value={bank} />}
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

  // An agent's id or handle: who it is, as payment apps show who you pay.
  const named = useDeferredValue(to.trim().toLowerCase());
  const lookup = useQuery({
    queryKey: ["agent-id", "recipient", named],
    queryFn: () => api.recipient(named),
    enabled: /^agt_[a-z0-9]{24}$/.test(named) || /^[a-z0-9][a-z0-9-]{1,39}$/.test(named),
    staleTime: 60_000,
    retry: false,
  });
  const payee = lookup.data?.found ? lookup.data.agent : null;
  const noWallet = payee && payee.wallet !== wallet?.mode;

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
          placeholder="Agent ID, handle, contact or 0x address"
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
        {payee && (
          <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-[var(--border)] p-2.5">
            <AgentAvatar mascot={payee.mascot} id={payee.id} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {payee.name}
                {payee.yours && (
                  <span className="font-normal text-[var(--muted-foreground)]"> · yours</span>
                )}
              </p>
              <p className="aid-mono truncate text-xs text-[var(--muted-foreground)]">{payee.id}</p>
            </div>
            {noWallet ? (
              <Chip tone="danger">
                {payee.wallet === "test"
                  ? "Only a test wallet"
                  : payee.wallet
                    ? "Only a live wallet"
                    : "No wallet"}
              </Chip>
            ) : payee.verified ? (
              <Chip tone="success">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                Verified owner
              </Chip>
            ) : (
              <Chip>Owner not verified</Chip>
            )}
          </div>
        )}
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
        disabled={!to.trim() || !value || !!noWallet || send.isPending}
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
        <Row term="Holds" value={walletHolds(wallet.mode)} />
        {network && network !== "test" && (
          <Row term="Network" value={NETWORK_LABELS[network] ?? network} />
        )}
        {(summary?.assets ?? []).map((a) => (
          <Row key={a.asset} term={a.asset} value={formatUsd(a.amount?.amount)} />
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
      {wallet.mode === "live" && (
        <Muted>
          This address only takes USDC and USDT on Base. Bitcoin, ETH or coins sent on another
          network can't be received and may be lost.
        </Muted>
      )}
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
