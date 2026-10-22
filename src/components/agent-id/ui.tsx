// The building blocks every Agent ID page uses, so pages look the same: one
// section style, one empty state, one set of chips for test/live and status.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  CreditCard,
  Mail,
  Phone,
  Server,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { errorMessage } from "@/lib/agent-id/client";
import {
  eventStatusLabel,
  eventStatusTone,
  formatDateTime,
  avatarColors,
  formatRelativeTime,
  initials,
  statusLabel,
  type Tone,
  MASCOTS,
  mascotOf,
} from "@/lib/agent-id/format";
import type { Kind, Mode } from "@/lib/agent-id/types";
import { useTestMode } from "@/lib/agent-id/queries";

export const KIND_ICONS: Record<Kind, LucideIcon> = {
  mail: Mail,
  phone: Phone,
  wallet: Wallet,
  card: CreditCard,
  vm: Server,
};

// --- Chips ------------------------------------------------------------------------

const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  ink: "bg-[var(--accent)] text-[var(--aid-ink)]",
  success: "bg-[var(--aid-success-bg)] text-[var(--aid-success)]",
  warning: "bg-[var(--aid-warning-bg)] text-[var(--aid-warning)]",
  danger: "bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]",
  test: "bg-[var(--aid-test-bg)] text-[var(--aid-test)]",
};

export function Chip({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: Tone;
  className?: string | undefined;
  children: ReactNode;
  title?: string | undefined;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Test or live, shown only on development deployments: in production every
// resource is real, so there is nothing to tell apart.
export function ModeBadge({ mode }: { mode: Mode }) {
  const testMode = useTestMode();
  if (!testMode) return null;
  return (
    <Chip tone={mode === "live" ? "success" : "test"}>{mode === "live" ? "Live" : "Test"}</Chip>
  );
}

// An agent's or a resource's state: active, paused, revoked, setting up.
export function StatusBadge({ status, pausedWord }: { status: string; pausedWord?: string }) {
  const tone: Tone =
    status === "active"
      ? "success"
      : status === "suspended" || status === "provisioning"
        ? "warning"
        : "danger";
  const label =
    status === "suspended" && pausedWord
      ? pausedWord
      : status === "provisioning"
        ? "Setting up"
        : statusLabel(status);
  return <Chip tone={tone}>{label}</Chip>;
}

// What happened to a message, call, payment or command.
export function EventStatus({ status, suffix }: { status: string; suffix?: string }) {
  return (
    <Chip tone={eventStatusTone(status)}>
      {eventStatusLabel(status)}
      {suffix}
    </Chip>
  );
}

export function TimeAgo({
  iso,
  className,
}: {
  iso: string | null | undefined;
  className?: string;
}) {
  return (
    <time
      dateTime={iso ?? undefined}
      title={iso ? formatDateTime(iso) : undefined}
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(iso)}
    </time>
  );
}

// --- Copying and secrets --------------------------------------------------------------

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
  }
}

export function CopyButton({
  text,
  label = "Copy",
  toastText = "Copied",
  variant = "outline",
  iconOnly = false,
  className,
}: {
  text: string;
  label?: string;
  toastText?: string;
  variant?: "outline" | "ghost" | "default";
  iconOnly?: boolean;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size={iconOnly ? "icon" : "sm"}
      variant={variant}
      className={cn(iconOnly && "h-8 w-8", className)}
      aria-label={iconOnly ? label : undefined}
      onClick={async () => {
        await copyText(text, toastText);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {!iconOnly && (done ? "Copied" : label)}
    </Button>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn("aid-code relative min-w-0", className)}>
      <pre className="overflow-x-auto whitespace-pre p-3 pr-12">
        <code>{code}</code>
      </pre>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton text={code} iconOnly variant="ghost" label="Copy" />
      </div>
    </div>
  );
}

// A one-line command with a Copy button: the main instruction on a view.
export function CommandLine({ command, primary = true }: { command: string; primary?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <code className="aid-code aid-mono aid-scroll-x min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-3 py-2">
        {command}
      </code>
      <CopyButton
        text={command}
        label="Copy"
        toastText="Command copied"
        variant={primary ? "default" : "outline"}
      />
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="aid-mono break-all text-[0.8125rem]">{children}</span>;
}

// A secret the API shows exactly once.
export function SecretOnce({ secret, children }: { secret: string; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg bg-[var(--aid-warning-bg)] p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--aid-warning)]">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Copy it now. You won't see it again.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          readOnly
          value={secret}
          aria-label="Secret"
          onFocus={(e) => e.currentTarget.select()}
          className="aid-mono h-9 w-full min-w-0 rounded-md border border-[var(--input)] bg-[var(--card)] px-3 text-sm"
        />
        <CopyButton text={secret} label="Copy" toastText="Copied" variant="default" />
      </div>
      {children}
    </div>
  );
}

// --- Layout -------------------------------------------------------------------------

export function PageHeader({
  title,
  meta,
  actions,
  back,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {meta && <div className="mt-1 text-sm text-[var(--muted-foreground)]">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// The one section style: a card with a title row and a body.
export function Section({
  title,
  actions,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn("aid-card min-w-0", className)}>
      {(title || actions) && (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  );
}

// Rows inside a flush section.
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="divide-y divide-[var(--border)]" aria-label={label}>
      {children}
    </ul>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      {children}
    </li>
  );
}

// The one empty state: an icon, a short line and, when there is one, the action.
export function Empty({
  children,
  action,
  icon: Icon,
}: {
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
      {Icon && (
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] text-[var(--aid-ink)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <p className="max-w-sm text-sm text-[var(--muted-foreground)]">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-5 py-10 text-center text-sm text-[var(--aid-danger)]"
    >
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// A short message inside a form or section (errors, results, warnings).
export function Notice({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "warning" | "success" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    warning: "bg-[var(--aid-warning-bg)] text-[var(--aid-warning)]",
    success: "bg-[var(--aid-success-bg)] text-[var(--aid-success)]",
    danger: "bg-[var(--aid-danger-bg)] text-[var(--aid-danger)]",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("rounded-lg px-3 py-2 text-sm", tones[tone], className)}
    >
      {children}
    </div>
  );
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs text-[var(--muted-foreground)]", className)}>{children}</p>;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--muted)]" />
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="aid-label">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--aid-danger)]">{hint}</p>}
    </div>
  );
}

export function KeyValues({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="aid-label">{item.term}</dt>
          <dd className="mt-1 break-words text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Forms ------------------------------------------------------------------------------

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--aid-danger)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}

// A row of buttons where one is chosen (folders, filters).
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex rounded-lg bg-[var(--muted)] p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            value === option.value
              ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A destructive button that asks first. With `typed`, the person types that
// text to confirm.
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  children,
  typed,
  disabled,
  variant = "ghost",
  size = "sm",
  className,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  children: ReactNode;
  typed?: string;
  disabled?: boolean;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !typed || text.trim() === typed;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          className={cn("text-[var(--aid-danger)] hover:text-[var(--aid-danger)]", className)}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90svh] overflow-y-auto sm:rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {typed && (
          <Field
            id="confirm-typed"
            label={
              <>
                Type <strong>{typed}</strong> to confirm
              </>
            }
          >
            <Input
              id="confirm-typed"
              value={text}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || busy}
            className="bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-[var(--destructive)]/90"
            onClick={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
                setText("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function toastError(error: unknown, title?: string) {
  toast.error(
    title ?? errorMessage(error),
    title ? { description: errorMessage(error) } : undefined,
  );
}

// --- Identity ------------------------------------------------------------------------

const MASCOT_SIZES = {
  sm: "h-8 w-8",
  md: "h-11 w-11",
  lg: "h-16 w-16",
  xl: "h-28 w-28",
} as const;

// An agent's face: its Timewarp mascot (Orbit, Nova or Cosmo). People and
// contacts keep their initials (Avatar).
export function AgentAvatar({
  mascot,
  id,
  size = "md",
  className,
}: {
  mascot?: string | null | undefined;
  // Without a mascot, the one that follows from the agent's id.
  id?: string | undefined;
  size?: keyof typeof MASCOT_SIZES;
  className?: string;
}) {
  const name =
    mascot && (MASCOTS as readonly string[]).includes(mascot) ? mascot : mascotOf(id ?? "agent");
  const pixels = size === "lg" || size === "xl" ? 256 : 128;
  return (
    <img
      src={`/agent-id/mascots/${name}-${pixels}.png`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", MASCOT_SIZES[size], className)}
    />
  );
}

const AVATAR_SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
} as const;

// Initials in a circle: lilac for your agents, a colour of their own for
// the people and agents they talk to.
export function Avatar({
  name,
  large = false,
  size,
  colorful = false,
}: {
  name: string;
  large?: boolean;
  size?: keyof typeof AVATAR_SIZES;
  colorful?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={colorful ? avatarColors(name) : undefined}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        !colorful && "bg-[var(--primary)] text-[var(--primary-foreground)]",
        AVATAR_SIZES[size ?? (large ? "lg" : "sm")],
      )}
    >
      {/[a-z]/i.test(name) ? initials(name) : <User className="h-1/2 w-1/2" />}
    </span>
  );
}

// A pop-up in the middle of the screen for one task (add money, send,
// verify…): the page stays where it was behind it.
export function Popup({
  open,
  onOpenChange,
  trigger,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-[var(--background)] p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-[var(--border)] px-6 py-4 text-left">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
