// Agent ID's own drawings of what an agent has, as small app-style tiles:
// an envelope, a wallet with a coin, a phone and a computer, each on its own
// colour. Drawn here (not an icon set) so they look like the product's own.
import { useId } from "react";

import { cn } from "@/lib/utils";

export type ArtKind = "mail" | "wallet" | "phone" | "vm";

const COLORS: Record<ArtKind, [string, string]> = {
  mail: ["#62B3FF", "#2F74E6"],
  wallet: ["#42D392", "#159A5C"],
  phone: ["#FFC35A", "#F2892A"],
  vm: ["#8A97AD", "#465267"],
};

export function ResourceArt({
  kind,
  size = 40,
  className,
}: {
  kind: ArtKind;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [from, to] = COLORS[kind];
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
      <rect width="40" height="40" rx="11" fill={`url(#${id}-shine)`} />
      {kind === "mail" && (
        <g>
          <rect x="9" y="12.5" width="22" height="15.5" rx="3.2" fill="#fff" />
          <path
            d="M10.2 14.2 19.1 21a1.5 1.5 0 0 0 1.8 0l8.9-6.8"
            fill="none"
            stroke={to}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="29.5" cy="12.5" r="3.6" fill="#FF5A5F" stroke="#fff" strokeWidth="1.4" />
        </g>
      )}
      {kind === "wallet" && (
        <g>
          <rect
            x="11"
            y="10.5"
            width="15"
            height="9"
            rx="2"
            fill="#fff"
            opacity="0.55"
            transform="rotate(-8 18 15)"
          />
          <rect x="8.5" y="14" width="23" height="15.5" rx="3.4" fill="#fff" />
          <path d="M23.5 19.2h8v5.6h-8a2.8 2.8 0 0 1 0-5.6Z" fill={to} opacity="0.9" />
          <circle cx="24.3" cy="22" r="1.3" fill="#fff" />
        </g>
      )}
      {kind === "phone" && (
        <g>
          <rect x="13.5" y="8.5" width="13" height="23" rx="3.2" fill="#fff" />
          <rect x="15.5" y="11.5" width="9" height="14.5" rx="1.4" fill={to} opacity="0.85" />
          <rect x="17.8" y="28" width="4.4" height="1.4" rx="0.7" fill={to} opacity="0.6" />
          <path
            d="M28.6 13.4a6 6 0 0 1 0 6.2M30.9 11.4a9 9 0 0 1 0 10.2"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === "vm" && (
        <g>
          <rect x="8.5" y="10.5" width="23" height="15.5" rx="2.8" fill="#fff" />
          <rect x="10.8" y="12.8" width="18.4" height="10.9" rx="1.4" fill={to} />
          <path
            d="m13.4 16.2 2.6 2.1-2.6 2.1M17.6 20.6h3.6"
            fill="none"
            stroke="#7CF0B4"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M17.5 26h5l1 3.6h-7Z" fill="#fff" opacity="0.85" />
          <rect x="14" y="29.2" width="12" height="1.8" rx="0.9" fill="#fff" />
        </g>
      )}
    </svg>
  );
}
