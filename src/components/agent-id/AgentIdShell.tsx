// The frame every Agent ID page renders in: the scoped Timewarp look, light or
// dark, toasts, and who is signed in.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentIdSessionProvider } from "@/lib/agent-id/session";
import "./agent-id.css";

export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "agent-id-theme";

type ThemeContextValue = {
  choice: ThemeChoice;
  dark: boolean;
  setChoice: (c: ThemeChoice) => void;
};
const ThemeContext = createContext<ThemeContextValue>({
  choice: "system",
  dark: false,
  setChoice: () => {},
});
export const useAgentIdTheme = () => useContext(ThemeContext);

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function AgentIdShell({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setChoiceState(readChoice());
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    setSystemDark(media.matches);
    const listen = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener?.("change", listen);
    return () => media.removeEventListener?.("change", listen);
  }, []);

  // Dialogs, menus and toasts render at the end of <body>: give <html> the same
  // scope while Agent ID is on screen, and take it away when it leaves.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("agent-id");
    if (choice === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = choice;
    return () => {
      root.classList.remove("agent-id");
      delete root.dataset["theme"];
    };
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be blocked; the choice still holds for this visit.
    }
  }, []);

  const dark = choice === "dark" || (choice === "system" && systemDark);

  return (
    <ThemeContext.Provider value={{ choice, dark, setChoice }}>
      <div className="agent-id min-h-svh" data-theme={choice === "system" ? undefined : choice}>
        <TooltipProvider delayDuration={200}>
          <AgentIdSessionProvider>{children}</AgentIdSessionProvider>
        </TooltipProvider>
        <Toaster
          theme={dark ? "dark" : "light"}
          position="bottom-right"
          closeButton
          richColors={false}
        />
      </div>
    </ThemeContext.Provider>
  );
}
