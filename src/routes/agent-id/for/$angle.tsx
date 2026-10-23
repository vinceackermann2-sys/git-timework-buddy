import { createFileRoute, notFound } from "@tanstack/react-router";

import { ANGLES, AnglePage, isAngle } from "@/components/agent-id/site/angles";
import { SitePage } from "@/components/agent-id/site/Site";

// One reason to use Agent ID per page: /agent-id/for/code, …/accountability,
// …/apis and …/claude-and-codex.
export const Route = createFileRoute("/agent-id/for/$angle")({
  beforeLoad: ({ params }) => {
    if (!isAngle(params.angle)) throw notFound();
  },
  head: ({ params }) => {
    const angle = isAngle(params.angle) ? ANGLES[params.angle] : null;
    return {
      meta: angle
        ? [
            { title: `${angle.title} · Timewarp Agent ID` },
            { name: "description", content: angle.description },
            { property: "og:title", content: angle.title },
            { property: "og:description", content: angle.description },
          ]
        : [],
    };
  },
  component: AnglePageRoute,
});

function AnglePageRoute() {
  const { angle } = Route.useParams();
  if (!isAngle(angle)) return null;
  return (
    <SitePage>
      <AnglePage slug={angle} />
    </SitePage>
  );
}
