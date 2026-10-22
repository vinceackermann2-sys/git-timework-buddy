// What an agent has, as small phone-style app tiles drawn for Agent ID: a
// green message bubble for its mail, a black wallet with cards in it, a green
// phone for its number, a computer for its machine, and a card.
import { useId } from "react";

import { cn } from "@/lib/utils";

export type ArtKind = "mail" | "wallet" | "phone" | "vm" | "card";

// The same green as a phone's messages and calls.
const GREEN = ["#6BEA7B", "#18B83A"] as const;

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
  const tile = (from: string, to: string) => (
    <>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="9.5" fill={`url(#${id}-bg)`} />
    </>
  );
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {kind === "mail" && (
        <g>
          {tile(...GREEN)}
          <path
            d="M20 8.6c-6.6 0-12 4.2-12 9.4 0 3 1.8 5.6 4.6 7.3-.2 1.7-1 3.2-2.3 4.4 2.3-.1 4.3-.9 5.9-2.2 1.2.3 2.5.5 3.8.5 6.6 0 12-4.2 12-9.4S26.6 8.6 20 8.6Z"
            fill="#fff"
          />
        </g>
      )}
      {kind === "phone" && (
        <g>
          {tile(...GREEN)}
          <path
            d="M27.6 24.3v2.6a1.8 1.8 0 0 1-1.9 1.8 17.6 17.6 0 0 1-7.7-2.7 17.3 17.3 0 0 1-5.3-5.3 17.6 17.6 0 0 1-2.7-7.7 1.8 1.8 0 0 1 1.8-1.9h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.8.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14.2 14.2 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.5 2.5.6a1.8 1.8 0 0 1 1.5 1.8Z"
            fill="#fff"
          />
        </g>
      )}
      {kind === "wallet" && (
        <g>
          {tile("#2C2C2E", "#0A0A0B")}
          {/* Cards standing in the wallet, each a little higher than the one in front. */}
          <rect x="8.5" y="8" width="23" height="9" rx="2" fill="#4FB4F0" />
          <rect x="8.5" y="11" width="23" height="9" rx="2" fill="#FFC93C" />
          <rect x="8.5" y="14" width="23" height="9" rx="2" fill="#5ED17A" />
          <rect x="8.5" y="17" width="23" height="9" rx="2" fill="#FF8A3D" />
          <path
            d="M7.5 21.5h25v8.3a2.7 2.7 0 0 1-2.7 2.7H10.2a2.7 2.7 0 0 1-2.7-2.7Z"
            fill="#3A3A3C"
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
          {tile("#F5F5F7", "#D2D2D7")}
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
          <path d="M7 24.6h26v.2a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 24.8Z" fill="#C7C7CC" />
          <path d="M17 27h6l.9 3.6h-7.8Z" fill="#AEAEB2" />
          <rect x="14.5" y="30.2" width="11" height="1.6" rx="0.8" fill="#8E8E93" />
        </g>
      )}
      {kind === "card" && (
        <g>
          {tile("#7B6CF6", "#4B3BD1")}
          <rect x="8" y="12" width="24" height="16" rx="2.6" fill="#fff" />
          <rect x="11" y="16" width="5" height="3.6" rx="0.9" fill="#E7C46A" />
          <rect x="11" y="23" width="9" height="1.6" rx="0.8" fill="#C7C2F5" />
          <circle cx="26" cy="23.6" r="2" fill="#FF8A3D" opacity="0.9" />
          <circle cx="28.4" cy="23.6" r="2" fill="#FFC93C" opacity="0.9" />
        </g>
      )}
    </svg>
  );
}
