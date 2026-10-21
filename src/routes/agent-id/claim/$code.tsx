import { createFileRoute } from "@tanstack/react-router";

import { ClaimFlow } from "@/components/agent-id/claim/ClaimFlow";

// An Agent ID's setup link, from the CLI or from /agent-id/claim. Open to
// everyone: the link and the email code stand in for a sign-in. Stripe's
// identity check comes back here with ?checked=1.
export const Route = createFileRoute("/agent-id/claim/$code")({
  validateSearch: (search: Record<string, unknown>): { checked?: boolean } =>
    search["checked"] !== undefined && search["checked"] !== "0" && search["checked"] !== false
      ? { checked: true }
      : {},
  head: () => ({ meta: [{ title: "Set up your Agent ID · Timewarp" }] }),
  component: ClaimPage,
});

function ClaimPage() {
  const { code } = Route.useParams();
  const { checked } = Route.useSearch();
  // A new page per link, so nothing typed for one claim shows on another.
  return <ClaimFlow key={code} code={code} checked={!!checked} />;
}
