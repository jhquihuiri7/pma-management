"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query from React.
 *
 * Layout that is only a matter of appearance belongs in Tailwind breakpoints;
 * this exists for the cases where the *behaviour* changes with the width — a
 * pane that must not be rendered at all, a panel whose default state differs —
 * and CSS cannot express it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` on purpose: the
 * snapshot is read synchronously on every client render, so there is no window
 * in which the component believes the wrong width, and the server snapshot is
 * declared separately instead of being guessed during hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // There is no viewport on the server. Answering "no" makes every caller
    // render its narrow layout first, which is the one that also fits wide.
    () => false
  );
}

/** The width at which the map and the table can share the screen. */
export const SPLIT_VIEW_QUERY = "(min-width: 1024px)";

/** Phone-sized: single pane, bigger targets, chrome collapsed by default. */
export const COMPACT_QUERY = "(max-width: 639px)";
