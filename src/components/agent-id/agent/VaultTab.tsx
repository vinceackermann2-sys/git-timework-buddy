// An agent's vault: sign-ins and keys kept only on its computer. The owner
// adds them here, sealed in this browser before they leave it, so neither
// Timewarp nor the AI ever sees them. The agent uses a key by asking Agent ID
// to make a request with it (vault_request), never reading it.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, KeyRound, Loader2, Plus } from "lucide-react";
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
import { formatRelativeTime } from "@/lib/agent-id/format";
import { queryKeys, shouldRetry, useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, VaultItem } from "@/lib/agent-id/types";
import { parseHosts, sealForVault, siteOrigin, type VaultSecret } from "@/lib/agent-id/vault";
import { ResourceArt } from "../ResourceArt";
import {
  Chip,
  ConfirmButton,
  ErrorState,
  Field,
  LoadingRows,
  Muted,
  Notice,
  Popup,
  Section,
  toastError,
} from "../ui";

export const vaultKey = (agentId: string) => [...queryKeys.agent(agentId), "vault"] as const;
export const useVault = (agentId: string) =>
  useQuery({ queryKey: vaultKey(agentId), queryFn: () => api.vault(agentId), retry: shouldRetry });

export function VaultTab({ agent }: { agent: Agent }) {
  const vault = useVault(agent.id);
  const queryClient = useQueryClient();
  const refresh = useRefreshAgent();
  // What the pop-up adds; it keeps showing while it closes.
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"login" | "key">("key");
  const add = (next: "login" | "key") => {
    setKind(next);
    setAdding(true);
  };
  const setup = useMutation({
    mutationFn: async (replace: boolean) => {
      // A computer from before agents ran as an ordinary user is replaced first.
      if (replace) await api.removeResource(agent.id, "vm");
      return api.setupVault(agent.id);
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(vaultKey(agent.id), data);
      await refresh(agent.id);
      toast.success("The vault is set up");
    },
  });
  const remove = useMutation({
    mutationFn: (item: VaultItem) => api.removeVaultItem(agent.id, item.id),
    onSuccess: () => void vault.refetch(),
    onError: (error) => toastError(error, "Couldn't remove it"),
  });

  if (vault.isPending)
    return (
      <Section>
        <LoadingRows rows={3} />
      </Section>
    );
  if (vault.isError)
    return (
      <Section>
        <ErrorState error={vault.error} onRetry={() => void vault.refetch()} />
      </Section>
    );
  const { vault: status, items } = vault.data;
  const active = agent.status === "active";

  if (!status.ready) {
    return (
      <Section>
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <ResourceArt kind="vault" size={56} />
          <h2 className="text-lg font-semibold">A vault on {agent.name}'s computer</h2>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">
            Sign-ins and keys, encrypted in your browser and kept only on its computer. Timewarp and
            the AI never see them.
          </p>
          {status.computer === "replace" && (
            <Notice tone="warning" className="max-w-md text-left">
              This computer was made before agents ran as an ordinary user. To keep a vault safe,
              replace it with a new one; its files are removed.
            </Notice>
          )}
          {setup.isError && <Notice tone="danger">{errorMessage(setup.error)}</Notice>}
          {status.computer === "replace" ? (
            <ConfirmButton
              title="Replace the computer?"
              description="Its files are removed, and the new one gets the vault."
              confirmLabel="Replace and set up"
              onConfirm={() => setup.mutateAsync(true)}
              disabled={!active || setup.isPending}
              variant="outline"
              size="default"
            >
              Replace computer
            </ConfirmButton>
          ) : (
            <Button
              size="lg"
              className="h-11 rounded-full px-6"
              disabled={!active || setup.isPending}
              onClick={() => setup.mutate(false)}
            >
              {setup.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Set up vault
            </Button>
          )}
          {setup.isPending && (
            <Muted>Setting it up on the computer: about a minute the first time.</Muted>
          )}
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <Section
        title={
          <span className="flex items-center gap-2">
            Vault {status.test && <Chip>Test computer</Chip>}
          </span>
        }
        actions={
          active && (
            <>
              <Button size="sm" variant="outline" onClick={() => add("login")}>
                <Plus aria-hidden="true" /> Sign-in
              </Button>
              <Button size="sm" variant="outline" onClick={() => add("key")}>
                <Plus aria-hidden="true" /> Key
              </Button>
            </>
          )
        }
        flush
      >
        <p className="px-5 pt-4 text-sm text-[var(--muted-foreground)]">
          Encrypted in your browser and kept only on {agent.name}'s computer. Timewarp and the AI
          never see them, and every use shows in Activity.
        </p>
        {items.length === 0 ? (
          <p className="px-5 pb-6 pt-4 text-sm">Nothing saved yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {item.kind === "login" ? (
                    <Globe className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">
                    {item.kind === "login"
                      ? `Sign-in for ${item.site?.replace(/^https:\/\//, "")}${item.totp ? " · with 2FA" : ""}`
                      : `Key for ${item.hosts.join(", ")}`}
                    {item.lastUsedAt ? ` · used ${formatRelativeTime(item.lastUsedAt)}` : ""}
                  </span>
                </span>
                <ConfirmButton
                  title={`Remove ${item.label}?`}
                  description={`It's deleted from ${agent.name}'s computer.`}
                  confirmLabel="Remove"
                  onConfirm={() => remove.mutateAsync(item)}
                >
                  Remove
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
        {items.some((item) => item.kind === "login") && (
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
            Keys work now. Sign-ins are used through {agent.name}'s browser, which comes next.
          </p>
        )}
      </Section>
      <Popup
        open={adding}
        onOpenChange={setAdding}
        title={kind === "login" ? "Add a sign-in" : "Add a key"}
      >
        {status.publicKey && (
          <AddItem
            agent={agent}
            key={kind}
            kind={kind}
            publicKey={status.publicKey}
            onDone={() => {
              setAdding(false);
              void vault.refetch();
            }}
          />
        )}
      </Popup>
    </div>
  );
}

type Send = "bearer" | "header" | "query" | "basic";
const SEND_LABELS: Record<Send, string> = {
  bearer: "Bearer token (Authorization header)",
  header: "Its own header",
  query: "A parameter in the address",
  basic: "Password (basic sign-in)",
};

// Sealed here, before anything leaves the browser.
function AddItem({
  agent,
  kind,
  publicKey,
  onDone,
}: {
  agent: Agent;
  kind: "login" | "key";
  publicKey: string;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [totp, setTotp] = useState("");
  const [hosts, setHosts] = useState("");
  const [send, setSend] = useState<Send>("bearer");
  const [name, setName] = useState("");
  const origin = siteOrigin(site);
  const hostList = parseHosts(hosts);
  const totpOk = !totp.trim() || /^[A-Z2-7=\s]{16,}$/i.test(totp.trim());
  const ready =
    kind === "login"
      ? !!origin && !!secret && totpOk
      : !!hostList &&
        !!secret &&
        (send !== "header" && send !== "query" ? true : /^[A-Za-z0-9-]{1,64}$/.test(name));
  const save = useMutation({
    mutationFn: async () => {
      const item: VaultSecret =
        kind === "login"
          ? {
              kind: "login",
              site: origin!,
              username: username.trim(),
              password: secret,
              ...(totp.trim() ? { totp: totp.replace(/\s+/g, "").toUpperCase() } : {}),
            }
          : {
              kind: "key",
              value: secret,
              hosts: hostList!,
              send:
                send === "header" || send === "query"
                  ? { as: send, name: name.trim() }
                  : send === "basic"
                    ? { as: "basic", username: name.trim() }
                    : { as: "bearer" },
            };
      const envelope = await sealForVault(publicKey, item);
      const fallback = kind === "login" ? origin!.replace(/^https:\/\//, "") : hostList![0]!;
      return api.addVaultItem(agent.id, { label: label.trim() || fallback, envelope });
    },
    onSuccess: () => {
      toast.success("Saved to the vault");
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) save.mutate();
  };
  const id = (s: string) => `vault-${s}`;
  return (
    <form onSubmit={submit} className="grid gap-4" autoComplete="off">
      <Field id={id("label")} label="Name">
        <Input
          id={id("label")}
          placeholder={kind === "login" ? "GitHub" : "OpenAI API"}
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {kind === "login" ? (
        <>
          <Field
            id={id("site")}
            label="Website"
            error={site.trim() && !origin ? "An https website, like github.com" : null}
          >
            <Input
              id={id("site")}
              placeholder="github.com"
              value={site}
              onChange={(e) => setSite(e.target.value)}
            />
          </Field>
          <Field id={id("user")} label="Username or email">
            <Input
              id={id("user")}
              value={username}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field id={id("secret")} label="Password">
            <Input
              id={id("secret")}
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field
            id={id("totp")}
            label={
              <>
                2FA setup key{" "}
                <span className="font-normal text-[var(--muted-foreground)]">Optional</span>
              </>
            }
            hint="The key shown when you set up an authenticator app, not a 6-digit code."
            error={!totpOk ? "That isn't a setup key" : null}
          >
            <Input
              id={id("totp")}
              type="password"
              autoComplete="off"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field id={id("secret")} label="Key">
            <Input
              id={id("secret")}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field
            id={id("hosts")}
            label="Sent only to"
            hint="The API's address, like api.openai.com. Several are separated by commas."
            error={hosts.trim() && !hostList ? "Website names, like api.openai.com" : null}
          >
            <Input
              id={id("hosts")}
              placeholder="api.openai.com"
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
            />
          </Field>
          <Field id={id("send")} label="Sent as">
            <Select value={send} onValueChange={(value) => setSend(value as Send)}>
              <SelectTrigger id={id("send")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SEND_LABELS) as Send[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {SEND_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {send !== "bearer" && (
            <Field
              id={id("name")}
              label={
                send === "basic" ? "Username" : send === "header" ? "Header name" : "Parameter name"
              }
            >
              <Input
                id={id("name")}
                placeholder={send === "header" ? "X-API-Key" : send === "query" ? "key" : ""}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
        </>
      )}
      {save.isError && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
      <Muted>Encrypted here, in your browser, before it's sent to {agent.name}'s computer.</Muted>
      <Button type="submit" disabled={!ready || save.isPending}>
        {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Save to vault
      </Button>
    </form>
  );
}
