// One agent's settings: its details, how to add it to an app, its keys, what
// it has, and pausing or revoking it.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/agent-id/client";
import {
  attachAgentCommand,
  claudeCodeCommand,
  codexConfig,
  envExport,
} from "@/lib/agent-id/connect";
import {
  KIND_LABELS,
  MASCOTS,
  ORIGIN_CHOICES,
  ORIGIN_LABELS,
  mascotOf,
  originOf,
  runtimeForOrigin,
} from "@/lib/agent-id/format";
import { useAccount, useRefreshAgent } from "@/lib/agent-id/queries";
import { API_BASE, api } from "@/lib/agent-id/session";
import { KINDS, type AgentDetail, type Kind, type Mascot } from "@/lib/agent-id/types";
import { cn } from "@/lib/utils";
import {
  AgentAvatar,
  CodeBlock,
  CommandLine,
  ConfirmButton,
  CopyButton,
  Empty,
  Field,
  ModeBadge,
  Muted,
  Notice,
  Row,
  Rows,
  SecretOnce,
  Section,
  StatusBadge,
  TimeAgo,
  toastError,
} from "../ui";

const PERSONAL = "__personal__";

export function SettingsTab({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const revoked = agent.status === "revoked";
  return (
    <div className="space-y-6">
      <Details detail={detail} />
      {!revoked && <AddToApp detail={detail} />}
      <Resources detail={detail} />
      {!revoked && <Access detail={detail} />}
    </div>
  );
}

function Details({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const account = useAccount();
  const refresh = useRefreshAgent();
  const origin = originOf(agent);
  const [name, setName] = useState(agent.name);
  const [app, setApp] = useState(origin.app);
  const [org, setOrg] = useState(agent.organizationId ?? PERSONAL);
  const current = agent.mascot ?? mascotOf(agent.id);
  const [mascot, setMascot] = useState<Mascot>(current);
  const revoked = agent.status === "revoked";

  useEffect(() => {
    setName(agent.name);
    setApp(originOf(agent).app);
    setOrg(agent.organizationId ?? PERSONAL);
    setMascot(agent.mascot ?? mascotOf(agent.id));
  }, [agent]);

  const patch = () => {
    const p: Parameters<typeof api.updateAgent>[1] = {};
    if (name.trim() !== agent.name) p.name = name.trim();
    if (app !== origin.app) {
      p.origin = { app };
      p.runtime = runtimeForOrigin(app);
    }
    const nextOrg = org === PERSONAL ? null : org;
    if (nextOrg !== agent.organizationId) p.organizationId = nextOrg;
    if (mascot !== current) p.mascot = mascot;
    return p;
  };
  const dirty = Object.keys(patch()).length > 0;
  const save = useMutation({
    mutationFn: () => api.updateAgent(agent.id, patch()),
    onSuccess: async () => {
      toast.success("Saved");
      await refresh(agent.id);
    },
  });
  const orgs = account.data?.organizations ?? [];
  const apps: string[] = ORIGIN_CHOICES.includes(origin.app as (typeof ORIGIN_CHOICES)[number])
    ? [...ORIGIN_CHOICES]
    : [origin.app, ...ORIGIN_CHOICES];

  return (
    <Section title="Details">
      <form
        className="grid gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (dirty && name.trim()) save.mutate();
        }}
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
          <Field id="settings-name" label="Name">
            <Input
              id="settings-name"
              value={name}
              maxLength={60}
              disabled={revoked}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="settings-origin" label="Main app" hint={origin.detail ?? undefined}>
            <Select value={app} onValueChange={setApp} disabled={revoked}>
              <SelectTrigger id="settings-origin">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {apps.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {slug === origin.app ? origin.label : (ORIGIN_LABELS[slug] ?? slug)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {(orgs.length > 0 || agent.organizationId) && (
            <Field id="settings-org" label="Belongs to">
              <Select value={org} onValueChange={setOrg} disabled={revoked}>
                <SelectTrigger id="settings-org">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PERSONAL}>Just me</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                  {agent.organizationId && !orgs.some((o) => o.id === agent.organizationId) && (
                    <SelectItem value={agent.organizationId}>{agent.organizationId}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <fieldset disabled={revoked}>
          <legend className="mb-2 text-sm font-medium">Mascot</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Mascot">
            {MASCOTS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mascot === m}
                aria-label={m[0]!.toUpperCase() + m.slice(1)}
                onClick={() => setMascot(m)}
                className={cn(
                  "grid place-items-center rounded-2xl border-2 p-1.5 transition-colors",
                  mascot === m
                    ? "border-[var(--aid-ink)] bg-[var(--accent)]"
                    : "border-transparent bg-[var(--muted)] hover:border-[var(--border)]",
                )}
              >
                <AgentAvatar mascot={m} size="lg" />
              </button>
            ))}
          </div>
        </fieldset>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="aid-label">Agent ID</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <span className="aid-mono truncate text-[13px]">{agent.id}</span>
              <CopyButton text={agent.id} iconOnly variant="ghost" label="Copy agent ID" />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="aid-label">Handle, for payments between your agents</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <span className="aid-mono truncate text-[13px]">{agent.handle}</span>
              <CopyButton text={agent.handle} iconOnly variant="ghost" label="Copy handle" />
            </dd>
          </div>
        </dl>
        {save.isError && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
        <div>
          <Button type="submit" disabled={revoked || !dirty || !name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

// Add this agent to an app with the CLI, or by hand; and its keys.
function AddToApp({ detail }: { detail: AgentDetail }) {
  const { agent, keys } = detail;
  const account = useAccount();
  const refresh = useRefreshAgent();
  const [fresh, setFresh] = useState<string | null>(null);
  const mcpUrl = account.data?.config.mcp ?? `${API_BASE}/mcp`;
  const createKey = useMutation({
    mutationFn: () => api.createAgentKey(agent.id),
    onSuccess: async (result) => {
      setFresh(result.secret);
      await refresh(agent.id);
    },
    onError: (error) => toastError(error, "Couldn't create a key"),
  });

  return (
    <Section title="Add to an app">
      <div className="space-y-2">
        <CommandLine command={attachAgentCommand(agent.handle)} primary={false} />
        <Muted>Run it on the computer where {agent.name} works.</Muted>
      </div>

      <details className="group mt-5 border-t border-[var(--border)] pt-4">
        <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium">
          Set up by hand
          <ChevronDown
            className="h-4 w-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <p className="aid-label">Claude Code</p>
            <CodeBlock code={claudeCodeCommand(mcpUrl, fresh)} />
          </div>
          <div className="space-y-1.5">
            <p className="aid-label">Codex · ~/.codex/config.toml</p>
            <CodeBlock code={codexConfig(mcpUrl)} />
            <CodeBlock code={envExport(fresh)} />
          </div>
        </div>
      </details>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Keys</p>
          <Button
            size="sm"
            variant="outline"
            disabled={createKey.isPending}
            onClick={() => createKey.mutate()}
          >
            {createKey.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            New key
          </Button>
        </div>
        {fresh && (
          <div className="mb-3">
            <SecretOnce secret={fresh} />
          </div>
        )}
        {keys.length === 0 ? (
          <Muted>No keys.</Muted>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{key.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    <span className="aid-mono">{key.prefix}…</span> ·{" "}
                    {key.lastUsedAt ? (
                      <>
                        used <TimeAgo iso={key.lastUsedAt} />
                      </>
                    ) : (
                      "never used"
                    )}
                  </p>
                </div>
                <ConfirmButton
                  title={`Revoke "${key.name}"?`}
                  description="Apps using it stop working at once."
                  confirmLabel="Revoke"
                  onConfirm={async () => {
                    try {
                      await api.revokeAgentKey(agent.id, key.id);
                      await refresh(agent.id);
                    } catch (error) {
                      toastError(error, "Couldn't revoke the key");
                    }
                  }}
                >
                  Revoke
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// What the agent has, to pause or remove. Cards are early-access applications.
function Resources({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const refresh = useRefreshAgent();
  const owned = KINDS.filter((k): k is Exclude<Kind, "card"> => k !== "card").filter(
    (k) => !!agent.resources[k],
  );
  const setStatus = useMutation({
    mutationFn: (input: { kind: Kind; status: "active" | "suspended" }) =>
      api.updateResource(agent.id, input.kind, { status: input.status }),
    onSuccess: async () => refresh(agent.id),
    onError: (error) => toastError(error),
  });

  return (
    <Section title="What it has" flush>
      {owned.length === 0 ? (
        <Empty>
          Nothing yet. Add mail, a phone, a wallet or a machine from the top of the page.
        </Empty>
      ) : (
        <Rows label="Resources">
          {owned.map((kind) => {
            const r = agent.resources[kind]!;
            return (
              <Row key={kind}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {KIND_LABELS[kind]} <ModeBadge mode={r.mode} />
                    {r.status !== "active" && <StatusBadge status={r.status} />}
                  </p>
                  <p className="aid-mono truncate text-xs text-[var(--muted-foreground)]">
                    {r.address ?? r.label}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {(r.status === "active" || r.status === "suspended") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={agent.status !== "active" || setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          kind,
                          status: r.status === "active" ? "suspended" : "active",
                        })
                      }
                    >
                      {r.status === "active" ? "Pause" : "Resume"}
                    </Button>
                  )}
                  <ConfirmButton
                    title={`Remove ${KIND_LABELS[kind].toLowerCase()}?`}
                    description={
                      r.mode === "live"
                        ? "It goes back to the provider and can't be recovered. Its history stays."
                        : "Its history stays."
                    }
                    confirmLabel="Remove"
                    disabled={agent.status === "revoked"}
                    onConfirm={async () => {
                      try {
                        await api.removeResource(agent.id, kind);
                        toast.success(`${KIND_LABELS[kind]} removed`);
                        await refresh(agent.id, { events: true });
                      } catch (error) {
                        toastError(error, "Couldn't remove it");
                      }
                    }}
                  >
                    Remove
                  </ConfirmButton>
                </div>
              </Row>
            );
          })}
        </Rows>
      )}
    </Section>
  );
}

function Access({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const refresh = useRefreshAgent();
  const status = useMutation({
    mutationFn: (next: "active" | "suspended") => api.updateAgent(agent.id, { status: next }),
    onSuccess: async (_r, next) => {
      toast.success(next === "suspended" ? `${agent.name} paused` : `${agent.name} resumed`);
      await refresh(agent.id);
    },
    onError: (error) => toastError(error, "Couldn't change the agent"),
  });
  return (
    <Section title="Pause or revoke">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={status.isPending}
          onClick={() => status.mutate(agent.status === "suspended" ? "active" : "suspended")}
        >
          {status.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {agent.status === "suspended" ? "Resume agent" : "Pause agent"}
        </Button>
        <ConfirmButton
          title={`Revoke ${agent.name}?`}
          description="Final. Its keys stop working and its mail, phone, wallet and computer are released. Its history stays."
          typed={agent.name}
          confirmLabel="Revoke"
          variant="outline"
          size="default"
          onConfirm={async () => {
            try {
              await api.revokeAgent(agent.id);
              toast.success(`${agent.name} revoked`);
              await refresh(agent.id, { events: true });
            } catch (error) {
              toastError(error, "Couldn't revoke the agent");
            }
          }}
        >
          Revoke agent
        </ConfirmButton>
      </div>
    </Section>
  );
}
