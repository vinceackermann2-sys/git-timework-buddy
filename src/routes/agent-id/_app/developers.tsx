import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Chip,
  CodeBlock,
  ConfirmButton,
  Empty,
  ErrorState,
  Field,
  LoadingRows,
  Muted,
  Notice,
  PageHeader,
  Row,
  Rows,
  SecretOnce,
  Section,
  TimeAgo,
  toastError,
} from "@/components/agent-id/ui";
import { errorMessage } from "@/lib/agent-id/client";
import { githubActionSnippet, verifySdkSnippet } from "@/lib/agent-id/connect";
import { isOrgAdmin } from "@/lib/agent-id/format";
import { queryKeys, useAccount, useRelyingParties } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { PolicyRequire, RelyingParty } from "@/lib/agent-id/types";

export const Route = createFileRoute("/agent-id/_app/developers")({
  head: () => ({ meta: [{ title: "Developers · Agent ID" }] }),
  component: DevelopersPage,
});

// Who an app lets in, in plain words.
const ACCEPT: { value: PolicyRequire; label: string }[] = [
  { value: "verified", label: "Agents with a verified owner" },
  { value: "kyb", label: "Only agents of verified businesses" },
  { value: "any", label: "Any agent with an Agent ID" },
];
const acceptLabel = (value: PolicyRequire | undefined) =>
  ACCEPT.find((a) => a.value === value)?.label ?? "Agents with a verified owner";

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-sm font-semibold text-[var(--primary-foreground)]"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function DevelopersPage() {
  const apps = useRelyingParties();
  const account = useAccount();
  const audience = apps.data?.[0]?.audience ?? "https://your-app.example.com";
  const orgNames = new Map((account.data?.organizations ?? []).map((o) => [o.id, o.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Developers" />

      <Section title="Accept only verified agents on your app">
        <ol className="space-y-6">
          <Step n={1} title="Register your app">
            <RegisterApp />
          </Step>
          <Step n={2} title="Copy its secret">
            <Muted>It's shown once, right after you register. Keep it on your server.</Muted>
          </Step>
          <Step n={3} title="Check each agent's passport">
            <CodeBlock code="npm install @timewarp/agent-id-verify" />
            <CodeBlock code={verifySdkSnippet(audience)} />
          </Step>
        </ol>
      </Section>

      <Section title="Protect your code">
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">
          Only commits signed by your company's verified agents pass.
        </p>
        <CodeBlock code={githubActionSnippet()} />
        <Muted className="mt-2">
          Use the secret of an app registered for your organization, saved as AGENT_ID_SECRET.
        </Muted>
      </Section>

      <Section title="Your registered apps" flush>
        {apps.isPending ? (
          <LoadingRows rows={2} />
        ) : apps.isError ? (
          <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />
        ) : apps.data.length === 0 ? (
          <Empty>No apps yet.</Empty>
        ) : (
          <Rows label="Apps">
            {apps.data.map((app) => (
              <AppRow
                key={app.id}
                app={app}
                orgName={app.organizationId ? orgNames.get(app.organizationId) : undefined}
              />
            ))}
          </Rows>
        )}
      </Section>
    </div>
  );
}

function AppRow({ app, orgName }: { app: RelyingParty; orgName: string | undefined }) {
  const queryClient = useQueryClient();
  return (
    <Row>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {app.name}
          <Chip tone="ink">{acceptLabel(app.policy.require)}</Chip>
          {orgName && <Chip>{orgName}</Chip>}
        </p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">
          <span className="aid-mono">{app.audience}</span> · added <TimeAgo iso={app.createdAt} />
        </p>
      </div>
      <ConfirmButton
        title={`Remove ${app.name}?`}
        description="Its secret stops working at once."
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api.revokeRelyingParty(app.id);
            toast.success(`${app.name} removed`);
            await queryClient.invalidateQueries({ queryKey: queryKeys.relyingParties });
          } catch (error) {
            toastError(error, "Couldn't remove it");
          }
        }}
      >
        Remove
      </ConfirmButton>
    </Row>
  );
}

const NO_ORG = "__none__";

function RegisterApp() {
  const account = useAccount();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [accept, setAccept] = useState<PolicyRequire>("verified");
  const [org, setOrg] = useState(NO_ORG);
  const [secret, setSecret] = useState<string | null>(null);
  const adminOrgs = (account.data?.organizations ?? []).filter((o) =>
    isOrgAdmin(account.data, o.id),
  );

  const create = useMutation({
    mutationFn: () =>
      api.createRelyingParty({
        name: name.trim(),
        audience: address.trim(),
        ...(org !== NO_ORG ? { organizationId: org } : {}),
        policy: { require: accept },
      }),
    onSuccess: async (result) => {
      setSecret(result.secret);
      await queryClient.invalidateQueries({ queryKey: queryKeys.relyingParties });
    },
  });

  function reset() {
    setName("");
    setAddress("");
    setAccept("verified");
    setOrg(NO_ORG);
    setSecret(null);
    create.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" /> Register app
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md sm:rounded-xl">
        {secret ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{name}'s secret</DialogTitle>
            </DialogHeader>
            <SecretOnce secret={secret} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim() && address.trim().length >= 3) create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Register an app</DialogTitle>
            </DialogHeader>
            <Field id="app-name" label="App name">
              <Input
                id="app-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              id="app-address"
              label="App address"
              hint="Usually its URL. Agents ask for passports for it."
            >
              <Input
                id="app-address"
                className="aid-mono"
                placeholder="https://api.example.com"
                value={address}
                maxLength={300}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field id="app-accept" label="Who can use it">
              <Select value={accept} onValueChange={(v) => setAccept(v as PolicyRequire)}>
                <SelectTrigger id="app-accept">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCEPT.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {adminOrgs.length > 0 && (
              <Field id="app-org" label="Organization" hint="Needed to protect your code.">
                <Select value={org} onValueChange={setOrg}>
                  <SelectTrigger id="app-org">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ORG}>None</SelectItem>
                    {adminOrgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {create.isError && <Notice tone="danger">{errorMessage(create.error)}</Notice>}
            <DialogFooter>
              <Button
                type="submit"
                disabled={!name.trim() || address.trim().length < 3 || create.isPending}
              >
                {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Register
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
