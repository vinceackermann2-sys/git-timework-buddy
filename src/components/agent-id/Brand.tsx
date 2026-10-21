import { Link } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentIdTheme, type ThemeChoice } from "./AgentIdShell";

export function Brand({
  to = "/agent-id",
  className,
}: {
  to?: "/agent-id" | "/agent-id/dashboard";
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn("flex min-w-0 items-center gap-2.5 rounded-md", className)}
      aria-label="Timewarp Agent ID home"
    >
      <img src="/desktop-auth-logo.svg" alt="" className="h-8 w-8 shrink-0" />
      <span className="truncate text-[15px] font-semibold tracking-tight">
        Timewarp <span className="text-[var(--aid-ink)]">Agent ID</span>
      </span>
    </Link>
  );
}

export const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeMenu() {
  const { choice, dark, setChoice } = useAgentIdTheme();
  const Icon = choice === "system" ? Monitor : dark ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Appearance">
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => setChoice(v as ThemeChoice)}>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="mr-2 h-4 w-4" aria-hidden="true" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
