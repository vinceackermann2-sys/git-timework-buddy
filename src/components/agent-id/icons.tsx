// Agent ID's own marks. Drawn on lucide's 24px grid with the same 2px stroke
// so they sit with lucide icons at 16–20px.
import type { SVGProps } from "react";
import {
  AppWindow,
  Bot,
  Braces,
  Cherry,
  Gem,
  History,
  MessageCircle,
  MousePointer2,
  Sparkles,
  SquareTerminal,
  Users,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// An ID badge with a small agent face: the "Agents" mark.
export function AgentsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <rect x="3" y="6" width="18" height="15" rx="4" />
      <path d="M12 6V3" />
      <path d="M10.5 2.5h3" />
      <path d="M9 12.5v.01" />
      <path d="M15 12.5v.01" />
      <path d="M9.5 16.5h5" />
    </svg>
  );
}

// A neutral mark per app an agent can come from. These are generic shapes,
// not the apps' logos; the label next to them carries the name.
const ORIGIN_GLYPHS: Record<string, LucideIcon> = {
  "claude-code": SquareTerminal,
  "claude-desktop": Sparkles,
  claude: Sparkles,
  codex: Braces,
  chatgpt: MessageCircle,
  cursor: MousePointer2,
  windsurf: Waves,
  gemini: Gem,
  copilot: Users,
  timewarp: History,
  energy: Zap,
  strawberry: Cherry,
  cline: SquareTerminal,
  roo: SquareTerminal,
  continue: Braces,
  kiro: AppWindow,
  qwen: SquareTerminal,
  factory: AppWindow,
  grok: Bot,
  hermes: Bot,
  moltbot: Bot,
  openclaw: Bot,
};

export function OriginGlyph({ app, className }: { app: string; className?: string }) {
  const Icon = ORIGIN_GLYPHS[app] ?? AppWindow;
  return <Icon className={cn("h-3.5 w-3.5", className)} aria-hidden="true" />;
}
