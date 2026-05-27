"use client";

export default function GeomGlyph({ type, color = "#737373" }: { type: string; color?: string }) {
  if (type === "Point" || type === "point")
    return (
      <svg viewBox="0 0 24 24" width="14" height="14">
        <circle cx="12" cy="12" r="5" fill={color} />
      </svg>
    );
  if (type === "LineString" || type === "line")
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <path d="M4 18 L10 10 L14 14 L20 6" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="2">
      <polygon points="4,6 12,3 20,8 18,18 6,18" />
    </svg>
  );
}
