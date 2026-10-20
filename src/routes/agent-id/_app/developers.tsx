import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  CodeBlock,
  CommandLine,
  CopyButton,
  Mono,
  Muted,
  PageHeader,
  Section,
  Segmented,
} from "@/components/agent-id/ui";
import {
  MCP_CLIENT_COMMAND,
  SDK_INSTALL,
  githubActionSnippet,
  mcpSnippet,
  onlineCheckSnippet,
  sdkSnippet,
  type SdkFramework,
} from "@/lib/agent-id/connect";
import { useAccount } from "@/lib/agent-id/queries";

export const Route = createFileRoute("/agent-id/_app/developers")({
  head: () => ({ meta: [{ title: "Developers · Agent ID" }] }),
  component: DevelopersPage,
});

const FRAMEWORKS: { value: SdkFramework; label: string }[] = [
  { value: "express", label: "Express" },
  { value: "next", label: "Next.js" },
  { value: "workers", label: "Hono / Workers" },
  { value: "fetch", label: "Any fetch handler" },
];

// For people building APIs and MCP servers: the SDK checks each agent's
// signed passport. No sign-up, no keys.
function DevelopersPage() {
  const account = useAccount();
  const [framework, setFramework] = useState<SdkFramework>("express");
  const orgs = account.data?.organizations ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Developers" meta="Agents prove who they are with a signed passport." />

      <Section title="Let only verified agents call your API">
        <div className="space-y-4">
          <CommandLine command={SDK_INSTALL} primary={false} />
          <Segmented
            label="Framework"
            value={framework}
            onChange={setFramework}
            options={FRAMEWORKS}
            className="flex-wrap"
          />
          <CodeBlock code={sdkSnippet(framework)} />
          <Muted>Use your API's own address as the audience.</Muted>
        </div>
      </Section>

      <Section title="Your MCP server">
        <div className="space-y-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Same check on your MCP endpoint. Agents using the Agent ID CLI send their passport
            automatically:
          </p>
          <CodeBlock code={MCP_CLIENT_COMMAND} />
          <CodeBlock code={mcpSnippet()} />
        </div>
      </Section>

      <Section title="Catch revoked agents instantly">
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Optional: ask Agent ID live, so a revoked agent is turned away at once.
          </p>
          <CodeBlock code={onlineCheckSnippet()} />
        </div>
      </Section>

      <Section title="Protect your code">
        <div className="space-y-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Only commits signed by your organization's verified agents pass.
          </p>
          <CodeBlock code={githubActionSnippet(orgs[0]?.id)} />
          {orgs.length > 0 && (
            <div>
              <p className="aid-label mb-2">Your organizations</p>
              <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {orgs.map((org) => (
                  <li key={org.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{org.name}</span>
                      <Mono>{org.id}</Mono>
                    </span>
                    <CopyButton
                      text={org.id}
                      iconOnly
                      variant="ghost"
                      label={`Copy ${org.name}'s id`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
