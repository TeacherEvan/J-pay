import type { Status } from "./types";

export function StatusIcon({ status }: { status: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (status as Status) {
    case "arrived":
      return (
        <svg {...common}>
          <path d="M9.5 2.5h4v11h-4" />
          <path d="M2 8h7.5M6.5 5l3 3-3 3" />
        </svg>
      );
    case "checkpoint":
      return (
        <svg {...common}>
          <path d="M4 14V2.5" />
          <path d="M4 3h7l-1.5 2.5L11 8H4" />
        </svg>
      );
    case "lunch":
      return (
        <svg {...common}>
          <path d="M3 6h8v3.5a4 4 0 0 1-8 0V6Z" />
          <path d="M11 6.5h1.25a1.75 1.75 0 0 1 0 3.5H11" />
          <path d="M2.5 14h9" />
        </svg>
      );
    case "quick side mission":
      return (
        <svg {...common}>
          <path d="M2.5 12.5 6 9l2.5 2.5L13.5 6" />
          <path d="M10 6h3.5v3.5" />
        </svg>
      );
    case "feeling sick":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8h5M8 5.5v5" />
        </svg>
      );
    case "day finish":
      return (
        <svg {...common}>
          <path d="M12.5 9.75A5.25 5.25 0 0 1 6.25 3.5a5.25 5.25 0 1 0 6.25 6.25Z" />
        </svg>
      );
    case "job finish":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
          <path d="m5.5 8 1.75 1.75L10.5 6.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
        </svg>
      );
  }
}
