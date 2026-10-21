// The apps an Agent ID is used in, as small app icons: simplified marks of
// Claude, OpenAI (Codex, ChatGPT), Cursor, Grok, Gemini, Windsurf, GitHub
// Copilot and Timewarp, drawn here so the site needs no icon package. Apps
// without a mark show their first letter. The label (a tooltip and the
// accessible name) always says which app it is.
import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { appLabel, groupApps, listLabel, markOf, type MarkId } from "@/lib/agent-id/apps";
import { avatarColors } from "@/lib/agent-id/format";
import type { AgentApp } from "@/lib/agent-id/types";

const round = (n: number) => Math.round(n * 100) / 100;

// Claude's spark: twelve rays of slightly different lengths.
const CLAUDE_RAYS = [0, 31, 58, 92, 118, 151, 182, 209, 241, 270, 302, 331].map((deg, i) => {
  const length = [10, 8.2, 9.4, 7.8, 10, 8.6, 9.2, 7.6, 9.8, 8.4, 9.6, 8][i]!;
  const r = (deg * Math.PI) / 180;
  return {
    x1: round(12 + Math.cos(r) * 1.4),
    y1: round(12 + Math.sin(r) * 1.4),
    x2: round(12 + Math.cos(r) * length),
    y2: round(12 + Math.sin(r) * length),
  };
});

function GeminiMark() {
  const id = `aid-gemini-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
      <defs>
        <linearGradient id={id} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4796E3" />
          <stop offset="0.55" stopColor="#9177C7" />
          <stop offset="1" stopColor="#CA6673" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c.4 5.4 4.6 9.6 10 10-5.4.4-9.6 4.6-10 10-.4-5.4-4.6-9.6-10-10 5.4-.4 9.6-4.6 10-10Z"
        fill={`url(#${id})`}
      />
    </>
  );
}

const MARK_ART: Record<Exclude<MarkId, "letter" | "timewarp">, () => ReactNode> = {
  claude: () => (
    <g stroke="#D97757" strokeWidth={2.3} strokeLinecap="round">
      {CLAUDE_RAYS.map((ray, i) => (
        <line key={i} {...ray} />
      ))}
    </g>
  ),
  openai: () => (
    <g fill="none" stroke="currentColor" strokeWidth={1.7}>
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect
          key={angle}
          x="12"
          y="2.6"
          width="5.2"
          height="11.2"
          rx="2.6"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </g>
  ),
  cursor: () => (
    <>
      <path d="M12 2.2 20.5 7.1v9.8L12 21.8 3.5 16.9V7.1Z" fill="currentColor" />
      <path
        d="M3.5 7.1 12 12l8.5-4.9M12 12v9.8"
        fill="none"
        stroke="var(--card)"
        strokeWidth={1.1}
      />
      <path d="M20.5 7.1 12 21.8V12Z" fill="var(--card)" opacity={0.85} />
    </>
  ),
  grok: () => (
    <g fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path d="M17.5 5.2A9 9 0 1 0 19.6 15" />
      <path d="M5 19 20.5 3.5" />
    </g>
  ),
  gemini: () => <GeminiMark />,
  windsurf: () => (
    <g fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round">
      <path d="M2.5 9c2.4-2.6 4.6-2.6 7 0s4.6 2.6 7 0 3.7-2.2 5-1" />
      <path d="M2.5 15c2.4-2.6 4.6-2.6 7 0s4.6 2.6 7 0 3.7-2.2 5-1" />
    </g>
  ),
  copilot: () => (
    <>
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
        <path d="M3.5 12.5c0-1.3.4-2.5 1-3.4M20.5 12.5c0-1.3-.4-2.5-1-3.4" />
        <path d="M3.5 12.5V16c0 1.6 3.8 4 8.5 4s8.5-2.4 8.5-4v-3.5" />
        <rect x="4.6" y="5" width="6.4" height="6" rx="2.6" />
        <rect x="13" y="5" width="6.4" height="6" rx="2.6" />
      </g>
      <path
        d="M9.6 14.6v1.6M14.4 14.6v1.6"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </>
  ),
};

// The mark alone, sized by its parent (a tile).
export function AppMark({
  app,
  label,
  className,
}: {
  app: string;
  label?: string | null;
  className?: string;
}) {
  const mark = markOf(app);
  if (mark === "timewarp")
    return <img src="/desktop-auth-logo.svg" alt="" className={cn("h-[72%] w-[72%]", className)} />;
  if (mark === "letter") {
    const name = appLabel(app, label);
    return (
      <span aria-hidden="true" className={cn("font-semibold leading-none", className)}>
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  const Art = MARK_ART[mark];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("h-[72%] w-[72%]", className)}>
      <Art />
    </svg>
  );
}

const TILE_SIZES = {
  xs: "h-[18px] w-[18px] rounded-[5px] text-[10px]",
  sm: "h-5 w-5 rounded-md text-[11px]",
  md: "h-7 w-7 rounded-lg text-sm",
  lg: "h-10 w-10 rounded-xl text-lg",
} as const;
export type AppIconSize = keyof typeof TILE_SIZES;

// An app icon: the mark on a small rounded tile, like an app on a phone.
export function AppIcon({
  app,
  label,
  size = "sm",
  tooltip = true,
  className,
}: {
  app: string;
  label?: string | null;
  size?: AppIconSize;
  tooltip?: boolean;
  className?: string;
}) {
  const name = appLabel(app, label);
  const letter = markOf(app) === "letter";
  const tile = (
    <span
      role="img"
      aria-label={name}
      style={letter ? avatarColors(name) : undefined}
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden text-[var(--foreground)]",
        !letter && "border border-[var(--border)] bg-[var(--card)]",
        TILE_SIZES[size],
        className,
      )}
    >
      <AppMark app={app} label={name} />
    </span>
  );
  if (!tooltip) return tile;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent className="bg-[var(--foreground)] text-[var(--background)]">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}

// The apps an agent is used in, one icon per maker, at most `max` of them.
export function AppIconRow({
  apps,
  max = 4,
  size = "sm",
  className,
}: {
  apps: Pick<AgentApp, "app" | "label">[];
  max?: number;
  size?: AppIconSize;
  className?: string;
}) {
  const groups = groupApps(apps);
  if (!groups.length) return null;
  const shown = groups.length > max ? groups.slice(0, max - 1) : groups;
  const rest = groups.slice(shown.length);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {shown.map((group) => (
        <AppIcon key={group.app} app={group.app} label={group.label} size={size} />
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={`Also ${listLabel(rest.flatMap((g) => g.labels))}`}
              className={cn(
                "inline-grid shrink-0 place-items-center bg-[var(--muted)] font-medium text-[var(--muted-foreground)]",
                TILE_SIZES[size],
              )}
            >
              +{rest.length}
            </span>
          </TooltipTrigger>
          <TooltipContent className="bg-[var(--foreground)] text-[var(--background)]">
            {listLabel(rest.flatMap((g) => g.labels))}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// An app with its name, as a pill ("Used in" on an agent's page).
export function AppChip({ app, label }: { app: string; label?: string | null }) {
  const name = appLabel(app, label);
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--card)] pl-1 pr-2.5 text-xs font-medium">
      <span aria-hidden="true" className="inline-flex">
        <AppIcon app={app} label={name} size="xs" tooltip={false} className="border-0" />
      </span>
      {name}
    </span>
  );
}
