import { cn } from "@/lib/utils";

/**
 * The app mark without its tile, for use inside the app: the page follows the text color, so it
 * reads in light and dark mode. The app icon is src/assets/logo.svg.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="22 18 94 94" aria-hidden className={cn("size-6", className)}>
      <path
        d="M34 25 H68 L85 42 V91 A4 4 0 0 1 81 95 H34 A4 4 0 0 1 30 91 V29 A4 4 0 0 1 34 25 Z M68 25 V38 A4 4 0 0 0 72 42 H85"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path
        d="M40 54 H72 M40 65 H64 M40 76 H68"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M88 52 C90 70 95 75 112 78 C95 81 90 86 88 104 C86 86 81 81 64 78 C81 75 86 70 88 52 Z"
        fill="#EF9F27"
        strokeWidth="6"
        strokeLinejoin="round"
        className="stroke-background"
      />
    </svg>
  );
}
