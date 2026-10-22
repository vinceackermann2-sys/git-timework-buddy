// What an agent has, drawn for Agent ID in a phone's style but without tiles
// behind them: a message bubble and a phone in Timewarp's purple-to-pink, a
// wallet with cards in it, a desktop computer, and a card.
import { useId } from "react";

import { cn } from "@/lib/utils";

export type ArtKind = "mail" | "wallet" | "phone" | "vm" | "card" | "vault";

// Drawn a little larger than the 40px box's middle, now that no tile frames them.
const GROW = "translate(20 20) scale(1.22) translate(-20 -20)";

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
  const brand = `url(#${id}-brand)`;
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}-brand`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A855F7" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <g transform={GROW}>
        {kind === "mail" && (
          <path
            d="M20 8.6c-6.6 0-12 4.2-12 9.4 0 3 1.8 5.6 4.6 7.3-.2 1.7-1 3.2-2.3 4.4 2.3-.1 4.3-.9 5.9-2.2 1.2.3 2.5.5 3.8.5 6.6 0 12-4.2 12-9.4S26.6 8.6 20 8.6Z"
            fill={brand}
          />
        )}
        {kind === "phone" && (
          <path
            d="M29.4 25v3.1a2.1 2.1 0 0 1-2.3 2.1 20.8 20.8 0 0 1-9.1-3.2 20.4 20.4 0 0 1-6.3-6.3 20.8 20.8 0 0 1-3.2-9.1 2.1 2.1 0 0 1 2.1-2.3h3.1a2.1 2.1 0 0 1 2.1 1.8c.1 1 .4 2 .7 3a2.1 2.1 0 0 1-.5 2.2l-1.3 1.3a16.8 16.8 0 0 0 6.3 6.3l1.3-1.3a2.1 2.1 0 0 1 2.2-.5c1 .3 2 .6 3 .7a2.1 2.1 0 0 1 1.8 2.2Z"
            fill={brand}
          />
        )}
        {kind === "wallet" && (
          <g>
            {/* Cards standing in the wallet, each a little higher than the one in front. */}
            <rect x="8.5" y="8" width="23" height="9" rx="2" fill="#4FB4F0" />
            <rect x="8.5" y="11" width="23" height="9" rx="2" fill="#FFC93C" />
            <rect x="8.5" y="14" width="23" height="9" rx="2" fill="#5ED17A" />
            <rect x="8.5" y="17" width="23" height="9" rx="2" fill="#FF8A3D" />
            <path
              d="M7.5 21.5h25v8.3a2.7 2.7 0 0 1-2.7 2.7H10.2a2.7 2.7 0 0 1-2.7-2.7Z"
              fill="#2C2C2E"
            />
            <path
              d="M7.5 21.5c4 0 6 3.3 12.5 3.3s8.5-3.3 12.5-3.3"
              fill="none"
              stroke="#5A5A5E"
              strokeWidth="1.2"
            />
          </g>
        )}
        {kind === "vm" && (
          <g>
            <defs>
              <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#5AC8FA" />
                <stop offset="0.55" stopColor="#7D6CF2" />
                <stop offset="1" stopColor="#E26CC4" />
              </linearGradient>
            </defs>
            {/* A desktop computer: screen, chin and stand. */}
            <rect x="7" y="9" width="26" height="18" rx="2.2" fill="#1D1D1F" />
            <rect x="8.4" y="10.4" width="23.2" height="13.6" rx="1" fill={`url(#${id}-screen)`} />
            <path
              d="M7 24.6h26v.2a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 24.8Z"
              fill="#C7C7CC"
            />
            <path d="M17 27h6l.9 3.6h-7.8Z" fill="#AEAEB2" />
            <rect x="14.5" y="30.2" width="11" height="1.6" rx="0.8" fill="#8E8E93" />
          </g>
        )}
        {kind === "vault" && (
          <g>
            <path
              d="M13.5 18v-3.5a6.5 6.5 0 0 1 13 0V18"
              fill="none"
              stroke={brand}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect x="9.5" y="17" width="21" height="15.5" rx="3.5" fill={brand} />
            <circle cx="20" cy="23.5" r="2.2" fill="#fff" />
            <rect x="19" y="24.5" width="2" height="4.2" rx="1" fill="#fff" />
          </g>
        )}
        {kind === "card" && (
          <g>
            <rect x="7" y="11" width="26" height="18" rx="3" fill={brand} />
            <rect x="10.5" y="15" width="5.5" height="4" rx="1" fill="#F6D98A" />
            <rect x="10.5" y="23.5" width="10" height="1.8" rx="0.9" fill="#fff" opacity="0.75" />
          </g>
        )}
      </g>
    </svg>
  );
}
