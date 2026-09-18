import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number | undefined, props: P) => ({
  width: size ?? 20,
  height: size ?? 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

/** Custom product mark: a rounded tile with a "loop" glyph — deliberately not Slack's. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label="Relay">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#ffffff" />
      <path
        d="M12 26.5c-3.6 0-6-2.6-6-6.3C6 16 9 13 13 13h8.5c2 0 3.5 1.5 3.5 3.4 0 1.9-1.5 3.4-3.5 3.4H15"
        stroke="#4a154b"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M28 13.5c3.6 0 6 2.6 6 6.3 0 4.2-3 7.2-7 7.2h-8.5c-2 0-3.5-1.5-3.5-3.4 0-1.9 1.5-3.4 3.5-3.4H25"
        stroke="#36c5f0"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export const Home = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 9.5 10 3l7 6.5V17H3z" />
    <path d="M8 17v-5h4v5" />
  </svg>
);
export const Dms = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 4.5h14v9H8l-4 3v-3H3z" />
  </svg>
);
export const Activity = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 3a4.5 4.5 0 0 1 4.5 4.5V11l1.5 2.5H4L5.5 11V7.5A4.5 4.5 0 0 1 10 3z" />
    <path d="M8.5 16a1.5 1.5 0 0 0 3 0" />
  </svg>
);
export const Later = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M5 3h10v14l-5-3.5L5 17z" />
  </svg>
);
export const More = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);
export const Back = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12.5 4 6.5 10l6 6" />
  </svg>
);
export const Forward = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m7.5 4 6 6-6 6" />
  </svg>
);
export const Clock = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4l2.5 1.5" />
  </svg>
);
export const Search = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </svg>
);
export const Help = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="10" cy="10" r="7" />
    <path d="M7.8 8a2.3 2.3 0 0 1 4.4.7c0 1.6-2.2 1.8-2.2 3.3" />
    <circle cx="10" cy="14.5" r=".7" fill="currentColor" stroke="none" />
  </svg>
);
export const Chevron = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m6 8 4 4 4-4" />
  </svg>
);
export const Compose = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 16h3l8-8-3-3-8 8zM11 6l3 3" />
  </svg>
);
export const Hash = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M7.5 3 6 17M14 3l-1.5 14M3.5 7.5h14M2.5 12.5h14" />
  </svg>
);
export const Lock = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </svg>
);
export const Plus = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);
export const Star = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m10 3 2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.8l-4.3 2.3.9-4.8L3.1 8l4.8-.6z" />
  </svg>
);
export const Headphones = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 12v-2a6 6 0 0 1 12 0v2" />
    <rect x="3" y="11.5" width="3.5" height="5" rx="1" />
    <rect x="13.5" y="11.5" width="3.5" height="5" rx="1" />
  </svg>
);
export const Bold = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M6 4h5a3 3 0 0 1 0 6H6zM6 10h5.5a3 3 0 0 1 0 6H6z" />
  </svg>
);
export const Italic = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 4h-4M12 16H8M11 4l-2 12" />
  </svg>
);
export const Strike = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 10h12M13.5 6.5C13 5 11.7 4 10 4 8 4 6.5 5.2 6.5 6.7c0 1 .5 1.8 1.5 2.3M6.5 13.5c.5 1.5 1.8 2.5 3.5 2.5 2 0 3.5-1.2 3.5-2.7 0-.6-.2-1.1-.5-1.5" />
  </svg>
);
export const Link = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M8 12.5 12.5 8M9 6.5l1.5-1.5a3 3 0 0 1 4.5 4.5L13.5 11M11 13.5 9.5 15a3 3 0 0 1-4.5-4.5L6.5 9" />
  </svg>
);
export const ListOl = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M8 5h9M8 10h9M8 15h9M3.5 4.2l1-.7v3M3.2 14.5c.4-.6 1.3-.8 1.8-.3s.1 1-.3 1.4L3.2 17h2.3" />
  </svg>
);
export const ListUl = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M8 5h9M8 10h9M8 15h9" />
    <circle cx="4" cy="5" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="15" r="1" fill="currentColor" stroke="none" />
  </svg>
);
export const Quote = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 4v12M8 6h9M8 10h9M8 14h6" />
  </svg>
);
export const Code = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m7 6-4 4 4 4M13 6l4 4-4 4" />
  </svg>
);
export const CodeBlock = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <path d="m8 8-2 2 2 2M12 8l2 2-2 2" />
  </svg>
);
export const Emoji = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="10" cy="10" r="7" />
    <path d="M7 11.5c.7 1.2 1.8 1.8 3 1.8s2.3-.6 3-1.8" />
    <circle cx="7.5" cy="8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r=".8" fill="currentColor" stroke="none" />
  </svg>
);
export const At = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="10" cy="10" r="3" />
    <path d="M13 10v1.5a1.5 1.5 0 0 0 3 0V10a6 6 0 1 0-2.4 4.8" />
  </svg>
);
export const Video = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="6" width="10" height="8" rx="1.5" />
    <path d="m13 9 4-2v6l-4-2" />
  </svg>
);
export const Mic = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
    <path d="M5 10a5 5 0 0 0 10 0M10 15v2" />
  </svg>
);
export const Slash = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m12.5 4-5 12" />
  </svg>
);
export const Aa = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m3 15 3.5-10L10 15M4.3 11.5h4.4M12 15v-6.5M12 11.5a2.2 2.2 0 1 1 4.4 0V15M16.4 12.5c-1.2 0-4.4-.3-4.4 1.3 0 1.1 1 1.4 1.9 1.4s2.5-.4 2.5-1.5" />
  </svg>
);
export const Send = ({ size, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor" stroke="none">
    <path d="M2.5 3.5 18 10 2.5 16.5 5 11l7-1-7-1z" />
  </svg>
);
export const Shield = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 2.5 16 5v5c0 3.8-2.6 6.4-6 7.5-3.4-1.1-6-3.7-6-7.5V5z" />
  </svg>
);
export const ShieldCheck = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 2.5 16 5v5c0 3.8-2.6 6.4-6 7.5-3.4-1.1-6-3.7-6-7.5V5z" />
    <path d="m7 10 2 2 4-4" />
  </svg>
);
export const Close = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
);
export const Play = ({ size, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor" stroke="none">
    <path d="M6 4v12l10-6z" />
  </svg>
);
export const Stop = ({ size, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor" stroke="none">
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
  </svg>
);
export const Filter = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 5h14l-5.5 6.5V16l-3-1.5v-3z" />
  </svg>
);
export const Members = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="7.5" cy="7" r="2.8" />
    <path d="M2.5 16c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" />
    <circle cx="13.5" cy="7.5" r="2.2" />
    <path d="M14 11.8c2 .3 3.3 1.7 3.6 4.2" />
  </svg>
);
export const Pin = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="m12 3 5 5-3 1-3.5 3.5.5 3-2-2L5 17l3.5-4-2-2 3-.5L13 7z" />
  </svg>
);
export const Bookmark = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M6 3h8v14l-4-3-4 3z" />
  </svg>
);
export const Reply = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 5.5h13v8H9l-4 3v-3H3z" />
  </svg>
);
export const Share = ({ size, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M11 4.5 17 10l-6 5.5V12c-4 0-6.5 1.3-8 4 .3-5 3-8 8-8.5z" />
  </svg>
);
