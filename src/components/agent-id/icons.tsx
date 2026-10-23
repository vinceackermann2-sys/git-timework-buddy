// Agent ID's own marks. Drawn on lucide's 24px grid with the same 2px stroke
// so they sit with lucide icons at 16–20px.
import { useId } from "react";
import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

// The "Agents" mark: Timewarp's mascot as a line drawing, a round head with
// one big eye and an orbit ring passing in front of it.
export function AgentsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = useId().replace(/:/g, "");
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
      <defs>
        {/* The ring's far side disappears behind the head. */}
        <mask id={`${id}-behind`}>
          <rect width="24" height="24" fill="#fff" />
          <circle cx="12" cy="12" r="7.6" fill="#000" />
        </mask>
        {/* Its near side passes in front. */}
        <clipPath id={`${id}-front`}>
          <rect x="-6" y="12" width="36" height="14" transform="rotate(-18 12 12)" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="6.2" />
      <circle cx="12" cy="11" r="1.7" fill="currentColor" stroke="none" />
      <ellipse
        cx="12"
        cy="12"
        rx="10.6"
        ry="3.4"
        transform="rotate(-18 12 12)"
        mask={`url(#${id}-behind)`}
      />
      <ellipse
        cx="12"
        cy="12"
        rx="10.6"
        ry="3.4"
        transform="rotate(-18 12 12)"
        clipPath={`url(#${id}-front)`}
      />
    </svg>
  );
}
