import type { SVGProps } from "react";

/**
 * The module's mark: a cloud with slanting rain, for a protocol of the El Niño
 * season (ENOS 2026-2027). Drawn like the Lucide icons around it (24 px grid,
 * 2 px round strokes, current colour), so it sizes and colours with `.ico`.
 */
export function IconoLluvia({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* The cloud, open below where the rain falls. */}
      <path d="M5.5 15.6A6.5 6.5 0 1 1 16 8.5h1.5a4.25 4.25 0 0 1 2.3 7.83" />
      {/* Rain blown slightly sideways, in streaks of different lengths, and a falling drop. */}
      <path d="m9 14-1.6 4" />
      <path d="m13.4 14-2.4 6" />
      <path d="m17.6 15.2-1.4 3.4" />
      <path d="M6.6 21h.01" />
    </svg>
  );
}
