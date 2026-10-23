import { createFileRoute } from "@tanstack/react-router";

import { ClaimFlow } from "@/components/agent-id/claim/ClaimFlow";

// An Agent ID's setup link, from the CLI or from /agent-id/claim. Open to
// everyone: the link and the email code stand in for a sign-in.
export const Route = createFileRoute("/agent-id/claim/$code")({
  head: () => ({ meta: [{ title: "Set up your Agent ID · Timewarp" }] }),
  component: ClaimPage,
});

function ClaimPage() {
  const { code } = Route.useParams();
  // A new page per link, so nothing typed for one claim shows on another.
  return <ClaimFlow key={code} code={code} />;
}
