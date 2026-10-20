import { useState } from "react";
import type { ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Chip,
  CommandLine,
  ConfirmButton,
  Empty,
  ErrorState,
  KeyValues,
  LoadingRows,
  Muted,
  PageHeader,
  Row,
  Rows,
  SecretOnce,
  Section,
  TimeAgo,
  toastError,
} from "@/components/agent-id/ui";
import { ATTACH_COMMAND, LOGIN_COMMAND, loginWithKey } from "@/lib/agent-id/connect";
import { planLabel, verificationStatusLabel } from "@/lib/agent-id/format";
import { queryKeys, useAccount, useOwnerKeys } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · Agent ID" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const account = useAccount();
  const person = account.data?.person;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Section title="Account">
        {account.isPending ? (
          <LoadingRows rows={2} />
        ) : account.isError ? (
          <ErrorState error={account.error} onRetry={() => void account.refetch()} />
        ) : (
          <KeyValues
            items={[
              ...(account.data.user.name ? [{ term: "Name", value: account.data.user.name }] : []),
              { term: "Email", value: account.data.user.email ?? "—" },
              { term: "Plan", value: planLabel(account.data.plan) },
              {
                term: "Verification",
                value: (
                  <span className="flex items-center gap-2">
                    <Chip tone={person?.status === "verified" ? "success" : "neutral"}>
                      {verificationStatusLabel(person?.status ?? "unverified")}
                    </Chip>
                    <Link to="/agent-id/verify" className="aid-link text-sm">
                      {person?.status === "verified" ? "View" : "Verify"}
                    </Link>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Section>

      <AddToAgents />
      <SignInKeys />
    </div>
  );
}

function Step({
  n,
  title,
  children,
  done,
}: {
  n: number;
  title: string;
  children?: ReactNode;
  done?: boolean;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-sm font-semibold text-[var(--primary-foreground)]"
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

// Three steps to give every agent on a computer its Agent ID.
function AddToAgents() {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createOwnerKey("Agent ID app"),
    onSuccess: async (result) => {
      setSecret(result.secret);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownerKeys });
    },
    onError: (error) => toastError(error, "Couldn't create a key"),
  });

  return (
    <Section title="Add Agent ID to your agents">
      <ol className="space-y-6">
        <Step n={1} title="Sign in on your computer">
          {secret ? (
            <SecretOnce secret={secret}>
              <CommandLine command={loginWithKey(secret)} primary={false} />
            </SecretOnce>
          ) : (
            <>
              <CommandLine command={LOGIN_COMMAND} primary={false} />
              <Button
                size="sm"
                variant="outline"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Create a sign-in key
              </Button>
            </>
          )}
        </Step>
        <Step n={2} title="Attach your agents">
          <CommandLine command={ATTACH_COMMAND} />
          <Muted>Finds your agents in Claude, Codex, Cursor, Gemini, Timewarp and more.</Muted>
        </Step>
        <Step n={3} title="Done">
          <p className="text-sm text-[var(--muted-foreground)]">
            They show up under{" "}
            <Link to="/agent-id/dashboard" className="aid-link">
              Agents
            </Link>
            .
          </p>
        </Step>
      </ol>
    </Section>
  );
}

function SignInKeys() {
  const keys = useOwnerKeys();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createOwnerKey(),
    onSuccess: async (result) => {
      setSecret(result.secret);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ownerKeys });
    },
    onError: (error) => toastError(error, "Couldn't create a key"),
  });

  return (
    <Section
      title="Sign-in keys"
      flush
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          New key
        </Button>
      }
    >
      {secret && (
        <div className="border-b border-[var(--border)] p-5">
          <SecretOnce secret={secret} />
        </div>
      )}
      {keys.isPending ? (
        <LoadingRows rows={2} />
      ) : keys.isError ? (
        <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <Empty>No keys yet.</Empty>
      ) : (
        <Rows label="Sign-in keys">
          {keys.data.map((key) => (
            <Row key={key.id}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{key.name}</p>
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
                description="The computer using it is signed out of Agent ID."
                confirmLabel="Revoke"
                onConfirm={async () => {
                  try {
                    await api.revokeOwnerKey(key.id);
                    await queryClient.invalidateQueries({ queryKey: queryKeys.ownerKeys });
                  } catch (error) {
                    toastError(error, "Couldn't revoke the key");
                  }
                }}
              >
                Revoke
              </ConfirmButton>
            </Row>
          ))}
        </Rows>
      )}
    </Section>
  );
}
