import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AgentIdShell } from "@/components/agent-id/AgentIdShell";

// Every /agent-id page: Agent ID's own look, sign-in state and toasts.
export const Route = createFileRoute("/agent-id")({
  head: () => ({
    meta: [
      { title: "Agent ID · Timewarp" },
      {
        name: "description",
        content:
          "Give every AI agent its own identity, inbox, phone number, wallet, card and machine, traceable to a verified person or business.",
      },
      { property: "og:title", content: "Timewarp Agent ID" },
      {
        property: "og:description",
        content:
          "Identity, mail, phone, wallet, card and a machine for every AI agent, with verified owners.",
      },
    ],
  }),
  component: AgentIdLayout,
});

function AgentIdLayout() {
  return (
    <AgentIdShell>
      <Outlet />
    </AgentIdShell>
  );
}
