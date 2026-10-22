import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BadgeCheck,
  ChevronsUpDown,
  ClipboardList,
  Code2,
  Coins,
  Loader2,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Brand, THEME_OPTIONS } from "@/components/agent-id/Brand";
import { useAgentIdTheme, type ThemeChoice } from "@/components/agent-id/AgentIdShell";
import { AgentsIcon } from "@/components/agent-id/icons";
import { PricingPopup, useOpenPricing } from "@/components/agent-id/Pricing";
import { Avatar, Chip, Empty } from "@/components/agent-id/ui";
import { AgentIdError, errorMessage } from "@/lib/agent-id/client";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/agent-id/session";
import { planLabel } from "@/lib/agent-id/format";
import { queryKeys, useAccount, useApprovals } from "@/lib/agent-id/queries";
import { approvalAmount } from "@/components/agent-id/ApprovalList";
import { counterpartyLabel } from "@/lib/agent-id/format";
import { toast } from "sonner";
import { useSession } from "@/lib/agent-id/session";

// The signed-in part of Agent ID: navigation, the account, and a sign-in check.
export const Route = createFileRoute("/agent-id/_app")({ component: DashboardLayout });

type NavPath =
  | "/agent-id/dashboard"
  | "/agent-id/approvals"
  | "/agent-id/verify"
  | "/agent-id/developers"
  | "/agent-id/reviews";

type NavItem = {
  to: NavPath;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    to: "/agent-id/dashboard",
    label: "Agents",
    icon: AgentsIcon,
    match: (p) => p.startsWith("/agent-id/dashboard") || p.startsWith("/agent-id/agents"),
  },
  {
    to: "/agent-id/approvals",
    label: "Approvals",
    icon: ShieldCheck,
    match: (p) => p.startsWith("/agent-id/approvals"),
  },
  {
    to: "/agent-id/verify",
    label: "Verification",
    icon: BadgeCheck,
    match: (p) => p.startsWith("/agent-id/verify"),
  },
  {
    to: "/agent-id/developers",
    label: "Developers",
    icon: Code2,
    match: (p) => p.startsWith("/agent-id/developers"),
  },
];

function DashboardLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    if (session.status === "signed-out")
      void navigate({ to: "/agent-id/sign-in", search: { redirect: href }, replace: true });
  }, [session.status, navigate, href]);

  if (session.status !== "signed-in") return <FullPageLoading />;
  return <SignedInLayout />;
}

function FullPageLoading() {
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Loading Agent ID">
      <div className="hidden w-64 shrink-0 border-r border-[var(--border)] p-4 lg:block">
        <Skeleton className="mb-8 h-8 w-40 bg-[var(--muted)]" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mb-2 h-9 w-full bg-[var(--muted)]" />
        ))}
      </div>
      <div className="flex-1 p-6 sm:p-10">
        <Skeleton className="mb-8 h-8 w-48 bg-[var(--muted)]" />
        <Skeleton className="h-40 w-full bg-[var(--muted)]" />
      </div>
    </div>
  );
}

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "text-[var(--foreground)]/80 hover:bg-[var(--accent)]",
      )}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {!!badge && (
        <span
          className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--aid-ink)] px-1.5 text-[11px] font-semibold text-[var(--background)]"
          aria-label={`${badge} waiting`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function SignedInLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const account = useAccount();
  const approvals = useApprovals({ poll: true });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [path]);

  // Pricing opens over whatever page is open; Stripe comes back with
  // ?pricing=added (paid) or ?pricing=open (cancelled).
  const pricingParam = new URLSearchParams(searchStr).get("pricing");
  const [pricingOpen, setPricingOpen] = useState(false);
  useEffect(() => {
    if (pricingParam) setPricingOpen(true);
  }, [pricingParam]);
  useOpenPricing(
    useCallback(() => {
      setMenuOpen(false);
      setPricingOpen(true);
    }, []),
  );
  const closePricing = (open: boolean) => {
    setPricingOpen(open);
    if (open || !pricingParam) return;
    const params = new URLSearchParams(searchStr);
    params.delete("pricing");
    const rest = params.toString();
    void navigate({ href: rest ? `${path}?${rest}` : path, replace: true });
  };

  // A payment an agent asks to make shows up wherever the owner is.
  const seenApprovals = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = approvals.data;
    if (!list) return;
    if (!seenApprovals.current) {
      seenApprovals.current = new Set(list.map((a) => a.id));
      return;
    }
    for (const a of list) {
      if (seenApprovals.current.has(a.id)) continue;
      seenApprovals.current.add(a.id);
      toast(`${a.agentName ?? "Your agent"} wants to send ${approvalAmount(a)}`, {
        description: `To ${counterpartyLabel(a.request.to)}`,
        duration: 20_000,
        action: {
          label: "Review",
          onClick: () => void navigate({ href: `/agent-id/approvals?id=${a.id}` }),
        },
      });
    }
  }, [approvals.data, navigate]);

  const expired = account.error instanceof AgentIdError && account.error.status === 401;
  const pending = approvals.data?.length ?? 0;
  const reviewer = account.data?.reviewer === true;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="mb-6 px-2">
        <Brand to="/agent-id/dashboard" />
      </div>
      <nav aria-label="Agent ID" className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            active={item.match(path)}
            {...(item.to === "/agent-id/approvals" ? { badge: pending } : {})}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            setPricingOpen(true);
          }}
          aria-haspopup="dialog"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
            pricingOpen
              ? "bg-[var(--accent)]"
              : "text-[var(--foreground)]/80 hover:bg-[var(--accent)]",
          )}
        >
          <Coins className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span className="flex-1">Pricing</span>
        </button>
        {reviewer && (
          <Link
            to="/agent-id/reviews"
            aria-current={path.startsWith("/agent-id/reviews") ? "page" : undefined}
            className={cn(
              "mt-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
              path.startsWith("/agent-id/reviews") && "bg-[var(--accent)] text-[var(--foreground)]",
            )}
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Review queue (staff)
          </Link>
        )}
      </nav>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <AccountMenu
          onSignOut={async () => {
            await session.signOut();
            void navigate({ to: "/agent-id" });
          }}
        />
      </div>
    </div>
  );

  // Everyone accepts the Agent ID Terms once, before anything else.
  if (account.data?.terms && !account.data.terms.accepted) {
    return (
      <TermsGate
        version={
          account.data.terms.current ??
          account.data.config.legal?.termsVersion ??
          account.data.terms.version ??
          "1"
        }
        updated={!!account.data.terms.acceptedAt}
        termsUrl={account.data.config.legal?.termsUrl}
        privacyUrl={account.data.config.legal?.privacyUrl}
        onSignOut={async () => {
          await session.signOut();
          void navigate({ to: "/agent-id" });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)] px-3 py-4 lg:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)]/90 px-4 backdrop-blur lg:hidden">
          <Brand to="/agent-id/dashboard" />
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="relative">
                <Menu aria-hidden="true" />
                {pending > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--aid-ink)]" />
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-[var(--card)] p-3 pt-4">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
          {expired ? (
            <Empty
              action={
                <Button
                  onClick={async () => {
                    await session.signOut();
                    void navigate({ to: "/agent-id/sign-in", search: { redirect: path } });
                  }}
                >
                  Sign in again
                </Button>
              }
            >
              Your session has expired.
            </Empty>
          ) : (
            <Outlet />
          )}
        </main>
        <PricingPopup open={pricingOpen} onOpenChange={closePricing} returned={pricingParam} />
        <footer className="px-4 pb-6 pt-2 text-center">
          <LegalLinks termsUrl={account.data?.config.legal?.termsUrl} />
        </footer>
      </div>
    </div>
  );
}

// Bottom left: who is signed in, and a menu with Settings, appearance and
// signing out.
function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const session = useSession();
  const account = useAccount();
  const { choice, setChoice } = useAgentIdTheme();
  const dev = session.status === "signed-in" && session.dev;
  const email =
    account.data?.user.email ?? (session.status === "signed-in" ? session.email : null) ?? "";
  const name = account.data?.user.name || email.split("@")[0] || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-[var(--accent)]"
        >
          <Avatar name={name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            {email && (
              <span className="block truncate text-xs text-[var(--muted-foreground)]">{email}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{name}</span>
          {email && (
            <span className="block truncate text-xs text-[var(--muted-foreground)]">{email}</span>
          )}
          {dev && (
            <span className="block text-xs text-[var(--aid-warning)]">
              Signed in with a dev token
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/agent-id/settings">
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Appearance</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={choice}
              onValueChange={(v) => setChoice(v as ThemeChoice)}
            >
              {THEME_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {!dev && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AGENT_ID_TERMS = "/legal/agent-id-terms";

function LegalLinks({ termsUrl }: { termsUrl?: string | undefined }) {
  return (
    <p className="text-[11px] text-[var(--muted-foreground)]">
      <a
        href="/legal/terms-of-service"
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        Terms
      </a>
      {" · "}
      <a href="/legal/privacy-policy" target="_blank" rel="noreferrer" className="hover:underline">
        Privacy
      </a>
      {" · "}
      <a
        href={termsUrl ?? AGENT_ID_TERMS}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        Agent ID Terms
      </a>
    </p>
  );
}

function TermsGate({
  version,
  updated,
  termsUrl,
  privacyUrl,
  onSignOut,
}: {
  version: string;
  // They accepted an earlier version.
  updated: boolean;
  termsUrl?: string | undefined;
  privacyUrl?: string | undefined;
  onSignOut: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api.acceptTerms(version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.account }),
    // The terms changed while this page was open: load the new version to accept.
    onError: (error) => {
      if (error instanceof AgentIdError && error.code === "terms_changed") {
        setAgreed(false);
        void queryClient.invalidateQueries({ queryKey: queryKeys.account });
      }
    },
  });
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Brand to="/agent-id" />
      </div>
      <div className="aid-card w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {updated ? "We've updated the Agent ID Terms" : "Before you start"}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {updated
            ? "Please read and accept them to keep using Agent ID."
            : "Agent ID gives your agents identities that trace back to you."}
        </p>
        <label className="mt-6 flex items-start gap-3 rounded-xl bg-[var(--muted)] p-4 text-sm leading-relaxed">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
            aria-label="I agree to the Agent ID Terms and the Privacy Policy"
          />
          <span>
            I agree to the{" "}
            <a
              href={termsUrl ?? AGENT_ID_TERMS}
              target="_blank"
              rel="noreferrer"
              className="aid-link"
            >
              Agent ID Terms
            </a>{" "}
            and the{" "}
            <a
              href={privacyUrl ?? "/legal/privacy-policy"}
              target="_blank"
              rel="noreferrer"
              className="aid-link"
            >
              Privacy Policy
            </a>
          </span>
        </label>
        {accept.isError && (
          <p className="mt-3 text-sm text-[var(--aid-danger)]" role="alert">
            {errorMessage(accept.error)}
          </p>
        )}
        <Button
          className="mt-6 h-11 w-full"
          disabled={!agreed || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Continue
        </Button>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-6 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        Sign out
      </button>
    </div>
  );
}
