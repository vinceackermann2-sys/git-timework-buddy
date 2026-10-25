// An agent's sections down the left of its page: what it has (mail, phone,
// wallet, card, computer, vault, connected apps, automations), each with where
// it stands, then its activity and settings. On phones, a row that scrolls sideways.
import type { ReactNode } from "react";
import { Activity, Loader2, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { automationsValue, connectorsValue, formatPhone, formatUsd } from "@/lib/agent-id/format";
import {
  isConnectorsUnavailable,
  useAutomations,
  useCardApplication,
  useConnectors,
  useConnectorsAvailable,
  usePhoneApplication,
  usePhonesWaitlist,
  useWalletSummary,
} from "@/lib/agent-id/queries";
import type { AgentDetail } from "@/lib/agent-id/types";
import { ResourceArt } from "../ResourceArt";
import type { AgentTab } from "./tabs";
import { useVault } from "./VaultTab";

export function AgentNav({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const { mail, phone, wallet, vm } = agent.resources;
  const active = agent.status === "active";
  const summary = useWalletSummary(agent.id, !!wallet && active && wallet.status === "active");
  const card = useCardApplication(agent.id);
  const phonesWaitlist = usePhonesWaitlist();
  const phoneApplication = usePhoneApplication(agent.id, phonesWaitlist && !phone);
  const balance = summary.data?.balance ?? wallet?.balance ?? null;
  const vault = useVault(agent.id);
  const connectorsAvailable = useConnectorsAvailable();
  const connectors = useConnectors(agent.id, connectorsAvailable === true);
  const automations = useAutomations(agent.id);
  const settingUp = (
    <span className="inline-flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Setting up
    </span>
  );

  const items: { tab: AgentTab; label: string; icon: ReactNode; value?: ReactNode }[] = [
    {
      tab: "mail",
      label: "Mail",
      icon: <ResourceArt kind="mail" size={32} />,
      value: mail?.status === "provisioning" ? settingUp : (mail?.address ?? "Add"),
    },
    {
      tab: "phone",
      label: "Phone",
      icon: <ResourceArt kind="phone" size={32} />,
      value:
        phone?.status === "provisioning"
          ? settingUp
          : phone
            ? formatPhone(phone.address)
            : phoneApplication.data
              ? "Applied"
              : "Apply",
    },
    {
      tab: "wallet",
      label: "Wallet",
      icon: <ResourceArt kind="wallet" size={32} />,
      value:
        wallet?.status === "provisioning"
          ? settingUp
          : wallet
            ? balance
              ? formatUsd(balance.amount)
              : "—"
            : "Add",
    },
    {
      tab: "card",
      label: "Card",
      icon: <ResourceArt kind="card" size={32} />,
      value: card.data ? "Applied" : "Apply",
    },
    {
      tab: "machine",
      label: "Computer",
      icon: <ResourceArt kind="vm" size={32} />,
      value: !vm
        ? "Starts on first use"
        : vm.status === "provisioning"
          ? settingUp
          : vm.details.machine
            ? vm.details.machine.charAt(0).toUpperCase() + vm.details.machine.slice(1)
            : "Ready",
    },
    {
      tab: "vault",
      label: "Vault",
      icon: <ResourceArt kind="vault" size={32} />,
      value: !vault.data
        ? ""
        : !vault.data.vault.ready
          ? "Set up"
          : vault.data.items.length === 1
            ? "1 saved"
            : `${vault.data.items.length} saved`,
    },
    {
      tab: "connectors",
      label: "Connectors",
      icon: <ResourceArt kind="connectors" size={32} />,
      value:
        connectorsAvailable === false || isConnectorsUnavailable(connectors.error)
          ? "Not available"
          : connectors.data
            ? connectorsValue(connectors.data)
            : "",
    },
    {
      tab: "automations",
      label: "Automations",
      icon: <ResourceArt kind="automations" size={32} />,
      value: automations.data ? automationsValue(automations.data) : "",
    },
    { tab: "activity", label: "Activity", icon: <Plain icon={<Activity className="h-5 w-5" />} /> },
    { tab: "settings", label: "Settings", icon: <Plain icon={<Settings className="h-5 w-5" />} /> },
  ];

  return (
    <div className="aid-scroll-x -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:overflow-visible">
      <TabsList
        aria-label={`${agent.name}'s sections`}
        className="flex h-auto w-max gap-1.5 bg-transparent p-0 lg:w-full lg:flex-col lg:items-stretch lg:gap-1"
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.tab}
            value={item.tab}
            className={cn(
              "flex h-auto items-center justify-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left shadow-none",
              "lg:border-transparent lg:bg-transparent",
              "hover:bg-[var(--muted)] data-[state=active]:border-[var(--border)] data-[state=active]:bg-[var(--card)] data-[state=active]:shadow-sm",
              item.tab === "activity" && "lg:mt-3",
            )}
          >
            {item.icon}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--foreground)]">
                {item.label}
              </span>
              {item.value !== undefined && (
                <span className="block max-w-[11rem] truncate text-xs font-normal text-[var(--muted-foreground)]">
                  {item.value}
                </span>
              )}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

// Activity and settings: a plain icon the size of the others.
function Plain({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center text-[var(--muted-foreground)]"
    >
      {icon}
    </span>
  );
}
