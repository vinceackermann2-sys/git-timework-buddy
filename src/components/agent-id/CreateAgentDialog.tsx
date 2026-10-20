import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
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
import { errorMessage } from "@/lib/agent-id/client";
import { ORIGIN_CHOICES, ORIGIN_LABELS, runtimeForOrigin } from "@/lib/agent-id/format";
import { queryKeys, useAccount } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { CreatedAgent } from "@/lib/agent-id/types";
import { Field, Notice, SecretOnce } from "./ui";

const PERSONAL = "__personal__";

export function CreateAgentDialog({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [app, setApp] = useState<string>("claude-code");
  const [org, setOrg] = useState(PERSONAL);
  const [created, setCreated] = useState<CreatedAgent | null>(null);
  const account = useAccount();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.createAgent({
        name: name.trim(),
        runtime: runtimeForOrigin(app),
        origin: { app },
        ...(org !== PERSONAL ? { organizationId: org } : {}),
      });
      // Older deployments take the app only through an update.
      if (created.agent.origin?.app !== app) {
        await api.updateAgent(created.agent.id, { origin: { app } }).catch(() => undefined);
      }
      return created;
    },
    onSuccess: async (result) => {
      setCreated(result);
      toast.success(`${result.agent.name} created`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.account }),
      ]);
    },
  });

  function reset() {
    setName("");
    setApp("claude-code");
    setOrg(PERSONAL);
    setCreated(null);
    create.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate();
  }

  const orgs = account.data?.organizations ?? [];
  const full = account.data ? account.data.agents.count >= account.data.agents.max : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus aria-hidden="true" /> New agent
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md sm:rounded-xl">
        {created ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{created.agent.name}'s key</DialogTitle>
            </DialogHeader>
            {created.secret ? (
              <SecretOnce secret={created.secret} />
            ) : (
              <Notice>No key was made. Create one in the agent's Connect tab.</Notice>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button asChild>
                <Link
                  to="/agent-id/agents/$agentId"
                  params={{ agentId: created.agent.id }}
                  search={{}}
                  onClick={() => setOpen(false)}
                >
                  Open agent
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New agent</DialogTitle>
            </DialogHeader>
            {full && (
              <Notice tone="warning">
                You have {account.data?.agents.max} agents, the most allowed. Revoke one first.
              </Notice>
            )}
            <Field id="agent-name" label="Name">
              <Input
                id="agent-name"
                value={name}
                maxLength={60}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field id="agent-origin" label="Runs in">
              <Select value={app} onValueChange={setApp}>
                <SelectTrigger id="agent-origin">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGIN_CHOICES.map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {ORIGIN_LABELS[slug]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {orgs.length > 0 && (
              <Field id="agent-org" label="Belongs to">
                <Select value={org} onValueChange={setOrg}>
                  <SelectTrigger id="agent-org">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PERSONAL}>Just me</SelectItem>
                    {orgs.map((o) => (
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
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
