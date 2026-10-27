import { type RefObject, useLayoutEffect, useRef } from "react";
import { useStore } from "./store";

// Hidden grids resize to zero. Restore after their ResizeObserver/layout pass, not before it.
export function useBrowseScroll(ref: RefObject<HTMLDivElement | null>, view: "discover" | "library", filterKey: string) {
  const activeView = useStore(state => state.view);
  const position = useRef(0);
  const previousFilter = useRef(filterKey);
  const restoring = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (previousFilter.current !== filterKey) {
      position.current = 0;
      previousFilter.current = filterKey;
    }
    if (activeView !== view) return;
    restoring.current = true;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        element.scrollTop = position.current;
        restoring.current = false;
      });
    });
    const save = () => {
      if (!restoring.current && useStore.getState().view === view) position.current = element.scrollTop;
    };
    element.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      element.removeEventListener("scroll", save);
    };
  }, [activeView, filterKey, ref, view]);
}
