import { useLayoutEffect, useRef, type RefObject } from "react";

const TABBABLE = "button, input, select, textarea, a[href], summary, [tabindex]";

/** Dialogs rendered outside #root must also isolate keyboard and assistive-technology focus. */
export function useModalFocus(dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!open || !panel) return;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    const previous = document.activeElement;
    if (root && !root.contains(panel)) root.inert = true;
    (panel.querySelector<HTMLElement>("[data-modal-autofocus]") ?? panel).focus({ preventScroll: true });

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter(element =>
        element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") &&
        element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible");
      const first = items[0], last = items.at(-1);
      const active = document.activeElement;
      if (!first || !panel.contains(active) || active === panel || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        ((event.shiftKey ? last : first) ?? panel).focus();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      if (root) root.inert = wasInert;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [dialog, open]);
}
