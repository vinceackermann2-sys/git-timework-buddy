import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centsToInput, parseAmount } from "@/lib/agent-id/format";
import { useRefreshAgent } from "@/lib/agent-id/queries";
import { api } from "@/lib/agent-id/session";
import type { Agent, Kind, ResourceSettings } from "@/lib/agent-id/types";
import { Field, Section, toastError } from "../ui";

export type LimitField = { key: keyof ResourceSettings; label: string };

const cents = (settings: ResourceSettings, key: keyof ResourceSettings) =>
  centsToInput(settings[key] as number | undefined);

// Money limits in the resource's currency; an empty field means no limit.
export function LimitsEditor({
  agent,
  kind,
  fields,
  settings,
  currency,
  extra,
  extraPatch,
  extraDirty = false,
  bare = false,
}: {
  agent: Agent;
  kind: Kind;
  fields: LimitField[];
  settings: ResourceSettings;
  currency: string | null;
  extra?: ReactNode;
  extraPatch?: () => Record<string, unknown>;
  extraDirty?: boolean;
  // Without the section card, for use inside a sheet.
  bare?: boolean;
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, cents(settings, f.key)]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const refresh = useRefreshAgent();
  const settingsKey = JSON.stringify(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValues(initial()), [settingsKey]);

  const errors = Object.fromEntries(
    fields.map((f) => {
      const raw = values[f.key] ?? "";
      return [
        f.key,
        raw.trim() && parseAmount(raw, { allowZero: true }) === null ? "Like 25.00" : null,
      ];
    }),
  );
  const invalid = Object.values(errors).some(Boolean);
  const dirty = extraDirty || fields.some((f) => (values[f.key] ?? "") !== cents(settings, f.key));

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = (values[f.key] ?? "").trim();
        patch[f.key] = raw ? parseAmount(raw, { allowZero: true }) : null;
      }
      return api.updateResource(agent.id, kind, {
        settings: { ...patch, ...(extraPatch?.() ?? {}) },
      });
    },
    onSuccess: async () => {
      toast.success("Limits saved");
      await refresh(agent.id);
    },
    onError: (error) => toastError(error, "Couldn't save the limits"),
  });

  const locked = agent.status === "revoked";
  const form = (
    <form
      className="grid gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-4">
        {fields.map((f) => (
          <Field key={f.key} id={`limit-${kind}-${f.key}`} label={f.label} error={errors[f.key]}>
            <div className="relative">
              <Input
                id={`limit-${kind}-${f.key}`}
                inputMode="decimal"
                placeholder="No limit"
                disabled={locked}
                className="pr-14"
                value={values[f.key] ?? ""}
                aria-invalid={!!errors[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-[var(--muted-foreground)]">
                {currency ?? "USD"}
              </span>
            </div>
          </Field>
        ))}
      </div>
      {extra}
      <div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={locked || !dirty || invalid || save.isPending}
        >
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save limits
        </Button>
      </div>
    </form>
  );
  return bare ? form : <Section title="Limits">{form}</Section>;
}
