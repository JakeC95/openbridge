import { type RefObject, useLayoutEffect, useRef } from "react";
import { useStore } from "./store";
import { readPreference, writePreference } from "./browsing-state";

// Hidden grids resize to zero. Restore after their ResizeObserver/layout pass, not before it.
export function useBrowseScroll(
  ref: RefObject<HTMLDivElement | null>,
  view: "discover" | "library",
  filterKey: string,
  options?: { loaded?: boolean; scope?: string }
) {
  const activeView = useStore(state => state.view);
  const catalogLoaded = useStore(state => !state.catalogLoading && state.page >= 0);
  const libraryLoaded = useStore(state => !state.libraryLoading && state.libraryScannedAt !== null);
  const storageKey = `scroll.${options?.scope ?? view}`;
  const position = useRef(0);
  const previousFilter = useRef(filterKey);
  const restoring = useRef(false);
  const loaded = options?.loaded ?? (view === "discover" ? catalogLoaded : libraryLoaded);
  const pendingRestore = useRef(false);
  const wasActive = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (previousFilter.current !== filterKey) {
      position.current = 0;
      previousFilter.current = filterKey;
      pendingRestore.current = true;
    }
    if (activeView !== view) { wasActive.current = false; return; }
    if (!wasActive.current) {
      wasActive.current = true;
      pendingRestore.current = true;
      const saved = readPreference<{ key?: string; top?: number } | null>(storageKey, null);
      if (position.current === 0 && saved?.key === filterKey && typeof saved.top === "number" && saved.top > 0) position.current = saved.top;
    }
    const shouldRestore = pendingRestore.current && loaded;
    restoring.current = shouldRestore;
    let second = 0;
    const first = shouldRestore ? requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        element.scrollTop = position.current;
        pendingRestore.current = false;
        restoring.current = false;
      });
    }) : 0;
    const save = () => {
      if (!restoring.current && useStore.getState().view === view) {
        if (pendingRestore.current && element.scrollTop === 0) return;
        pendingRestore.current = false;
        position.current = element.scrollTop;
        writePreference(storageKey, { key: filterKey, top: element.scrollTop });
      }
    };
    element.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      element.removeEventListener("scroll", save);
    };
  }, [activeView, filterKey, loaded, ref, storageKey, view]);
}
