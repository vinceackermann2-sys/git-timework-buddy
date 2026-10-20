import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { errorMessage } from "@/lib/agent-id/client";
import { KIND_LABELS, liveAvailability } from "@/lib/agent-id/format";
import { useAccount, useAgent, useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, BillingAddress, Kind, Mode, ProvisionInput } from "@/lib/agent-id/types";
import { Field, Muted, Notice } from "../ui";

export const GIVE_LABELS: Record<Kind, string> = {
  mail: "Give mail",
  phone: "Give a phone",
  wallet: "Give a wallet",
  card: "Give a card",
  vm: "Give a machine",
};

export function ProvisionDialog({
  agent,
  kind,
  primary = false,
  inline = false,
}: {
  agent: Agent;
  kind: Kind;
  primary?: boolean;
  // A small "Add" link, as on the agent's ID card.
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("test");
  const [size, setSize] = useState<"small" | "medium">("medium");
  const [country, setCountry] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [billing, setBilling] = useState<BillingAddress>({
    line1: "",
    line2: "",
    city: "",
    postal_code: "",
    state: "",
    country: "",
  });
  const account = useAccount();
  const detail = useAgent(agent.id);
  const refresh = useRefreshAgent();

  const live = liveAvailability(kind, account.data?.config, {
    plan: account.data?.plan,
    verified: detail.data?.verification.verified,
  });
  const needsVerification = live.requirements.some((r) => !r.met && r.label === "a verified owner");
  const billingComplete =
    !!billing.line1.trim() &&
    !!billing.city.trim() &&
    !!billing.postal_code.trim() &&
    /^[A-Za-z]{2}$/.test(billing.country.trim());

  const provision = useMutation({
    mutationFn: () => {
      const options: NonNullable<ProvisionInput["options"]> = {};
      if (kind === "vm") options.size = size;
      if (kind === "phone" && mode === "live") {
        if (country.trim()) options.country = country.trim().toUpperCase();
        if (areaCode.trim()) options.areaCode = areaCode.trim();
      }
      if (kind === "card" && mode === "live") {
        options.billing = {
          line1: billing.line1.trim(),
          city: billing.city.trim(),
          postal_code: billing.postal_code.trim(),
          country: billing.country.trim().toUpperCase(),
          ...(billing.line2?.trim() ? { line2: billing.line2.trim() } : {}),
          ...(billing.state?.trim() ? { state: billing.state.trim() } : {}),
        };
      }
      return api.provision(agent.id, {
        kind,
        mode,
        ...(Object.keys(options).length ? { options } : {}),
      });
    },
    onSuccess: async () => {
      toast.success(`${KIND_LABELS[kind]} added to ${agent.name}`);
      setOpen(false);
      await refresh(agent.id);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (provision.isPending) return;
    if (mode === "live" && kind === "card" && !billingComplete) return;
    provision.mutate();
  }

  const setBill = (key: keyof BillingAddress) => (value: string) =>
    setBilling((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          provision.reset();
          setMode("test");
        }
      }}
    >
      <DialogTrigger asChild>
        {inline ? (
          <button
            type="button"
            disabled={agent.status !== "active"}
            className="aid-link inline-flex items-center gap-1 text-sm font-medium disabled:opacity-50"
            aria-label={GIVE_LABELS[kind]}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
          </button>
        ) : (
          <Button
            size="sm"
            variant={primary ? "default" : "outline"}
            disabled={agent.status !== "active"}
          >
            <Plus aria-hidden="true" /> {GIVE_LABELS[kind]}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md sm:rounded-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {GIVE_LABELS[kind]} to {agent.name}
            </DialogTitle>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Mode</legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="grid grid-cols-2 gap-2"
            >
              <Choice
                value="test"
                checked={mode === "test"}
                title="Test"
                text="Free, inside Agent ID"
              />
              <Choice
                value="live"
                checked={mode === "live"}
                disabled={!live.ready}
                title="Live"
                text="Real provider"
              />
            </RadioGroup>
            {!live.ready && live.reason && (
              <Muted>
                {live.reason}
                {needsVerification && (
                  <>
                    {" "}
                    <Link to="/agent-id/verify" className="aid-link">
                      Verify
                    </Link>
                  </>
                )}
              </Muted>
            )}
          </fieldset>

          {kind === "vm" && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Size</legend>
              <RadioGroup
                value={size}
                onValueChange={(v) => setSize(v as "small" | "medium")}
                className="grid grid-cols-2 gap-2"
              >
                <Choice
                  value="small"
                  checked={size === "small"}
                  title="Small"
                  text="½ vCPU · 1 GB"
                />
                <Choice
                  value="medium"
                  checked={size === "medium"}
                  title="Medium"
                  text="1 vCPU · 2 GB"
                />
              </RadioGroup>
            </fieldset>
          )}

          {kind === "phone" && mode === "live" && (
            <div className="grid grid-cols-2 gap-3">
              <Field id="phone-country" label="Country">
                <Input
                  id="phone-country"
                  value={country}
                  maxLength={2}
                  placeholder="US"
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                />
              </Field>
              <Field id="phone-area" label="Area code">
                <Input
                  id="phone-area"
                  value={areaCode}
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="415"
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
          )}

          {kind === "card" && mode === "live" && (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Billing address</legend>
              <Field id="bill-line1" label="Address">
                <Input
                  id="bill-line1"
                  autoComplete="address-line1"
                  value={billing.line1}
                  onChange={(e) => setBill("line1")(e.target.value)}
                />
              </Field>
              <Field id="bill-line2" label="Address line 2">
                <Input
                  id="bill-line2"
                  autoComplete="address-line2"
                  value={billing.line2 ?? ""}
                  onChange={(e) => setBill("line2")(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="bill-city" label="City">
                  <Input
                    id="bill-city"
                    autoComplete="address-level2"
                    value={billing.city}
                    onChange={(e) => setBill("city")(e.target.value)}
                  />
                </Field>
                <Field id="bill-postal" label="Postal code">
                  <Input
                    id="bill-postal"
                    autoComplete="postal-code"
                    value={billing.postal_code}
                    onChange={(e) => setBill("postal_code")(e.target.value)}
                  />
                </Field>
                <Field id="bill-state" label="State">
                  <Input
                    id="bill-state"
                    autoComplete="address-level1"
                    value={billing.state ?? ""}
                    onChange={(e) => setBill("state")(e.target.value)}
                  />
                </Field>
                <Field id="bill-country" label="Country">
                  <Input
                    id="bill-country"
                    autoComplete="country"
                    maxLength={2}
                    placeholder="US"
                    value={billing.country}
                    onChange={(e) => setBill("country")(e.target.value.toUpperCase())}
                  />
                </Field>
              </div>
            </fieldset>
          )}

          {provision.isError && <Notice tone="danger">{errorMessage(provision.error)}</Notice>}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                provision.isPending || (mode === "live" && kind === "card" && !billingComplete)
              }
            >
              {provision.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {mode === "live" ? "Add live" : "Add test"} {KIND_LABELS[kind].toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  value,
  checked,
  disabled,
  title,
  text,
}: {
  value: string;
  checked: boolean;
  disabled?: boolean;
  title: string;
  text: string;
}) {
  const id = `choice-${value}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
        checked ? "border-[var(--aid-ink)] bg-[var(--accent)]" : "border-[var(--border)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <RadioGroupItem
        id={id}
        value={value}
        disabled={disabled}
        className="mt-0.5"
        aria-label={title}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-[var(--muted-foreground)]">{text}</span>
      </span>
    </label>
  );
}
