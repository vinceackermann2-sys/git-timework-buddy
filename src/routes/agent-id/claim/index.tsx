import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { EmailForm, useStartClaim } from "@/components/agent-id/claim/ClaimFlow";
import { ClaimHeading, ClaimLayout } from "@/components/agent-id/claim/ClaimLayout";
import { errorMessage } from "@/lib/agent-id/client";

// Getting an Agent ID without an account: an email (and the terms), then the
// code on the next page, and the agent is ready. No name to think of: it's
// named after its owner and can be renamed later.
export const Route = createFileRoute("/agent-id/claim/")({
  head: () => ({ meta: [{ title: "Get an Agent ID · Timewarp" }] }),
  component: StartClaimPage,
});

function StartClaimPage() {
  const navigate = useNavigate();
  const start = useStartClaim();

  return (
    <ClaimLayout
      footer={
        <>
          Already have an account?{" "}
          <Link to="/agent-id/sign-in" className="aid-link font-medium">
            Sign in
          </Link>
        </>
      }
    >
      <ClaimHeading title="Get your Agent ID">
        Free, no card. Your AI agent gets its own email, wallet and computer, tied to you. Enter
        your email to start.
      </ClaimHeading>
      <EmailForm
        pending={start.isPending}
        error={start.isError ? errorMessage(start.error) : null}
        onSubmit={(email, agreed) =>
          start.mutate(
            { email, agreed },
            {
              onSuccess: (code) => void navigate({ to: "/agent-id/claim/$code", params: { code } }),
            },
          )
        }
      />
    </ClaimLayout>
  );
}
