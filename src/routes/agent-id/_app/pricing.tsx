import { createFileRoute } from "@tanstack/react-router";

import { PricingDetails, PublicPricing, SUMMARY } from "@/components/agent-id/Pricing";
import { PageHeader } from "@/components/agent-id/ui";
import { useSession } from "@/lib/agent-id/session";

export const Route = createFileRoute("/agent-id/_app/pricing")({
  validateSearch: (search: Record<string, unknown>): { credits?: string } =>
    typeof search["credits"] === "string" ? { credits: search["credits"] } : {},
  head: () => ({ meta: [{ title: "Pricing · Agent ID" }] }),
  component: PricingPage,
});

// A page in the app, like Settings; people not signed in see it on its own.
function PricingPage() {
  const session = useSession();
  // "added" once Stripe sends the owner back after paying.
  const { credits: returned } = Route.useSearch();
  if (session.status !== "signed-in") return <PublicPricing />;
  return (
    <div>
      <PageHeader title="Pricing" meta={SUMMARY} />
      <PricingDetails signedIn returned={returned} />
    </div>
  );
}
