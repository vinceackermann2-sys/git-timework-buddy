import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import { EmailForm, useTermsVersion } from "@/components/agent-id/claim/ClaimFlow";
import { ClaimHeading, ClaimLayout } from "@/components/agent-id/claim/ClaimLayout";
import { writeClaimMemory } from "@/lib/agent-id/claims";
import { errorMessage } from "@/lib/agent-id/client";
import { claimsApi } from "@/lib/agent-id/session";

// Getting an Agent ID without an account: an email (and the terms), then the
// code on the next page, and the agent is ready. No name to think of: it's
// named after its owner and can be renamed later.
export const Route = createFileRoute("/agent-id/claim/")({
  head: () => ({ meta: [{ title: "Get an Agent ID · Timewarp" }] }),
  component: StartClaimPage,
});

function StartClaimPage() {
  const navigate = useNavigate();
  const termsVersion = useTermsVersion();
  const start = useMutation({
    mutationFn: async ({ email, agreed }: { email: string; agreed: boolean }) => {
      const started = await claimsApi.start();
      const sent = await claimsApi.sendCode(started.claim.code, email);
      writeClaimMemory(started.claim.code, {
        secret: started.secret,
        sentEmail: sent.email,
        sentAt: String(Date.now()),
        terms: agreed ? termsVersion : null,
        devCode: sent.devCode ?? null,
      });
      return started.claim.code;
    },
    onSuccess: (code) => void navigate({ to: "/agent-id/claim/$code", params: { code } }),
  });

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
        Free, no card. Your AI gets its own email, wallet, computer and memory, so it can finish the
        job. Enter your email to start.
      </ClaimHeading>
      <EmailForm
        pending={start.isPending}
        error={start.isError ? errorMessage(start.error) : null}
        onSubmit={(email, agreed) => start.mutate({ email, agreed })}
      />
    </ClaimLayout>
  );
}
