/**
 * Makes a panel a dialog for the keyboard: when it opens, focus moves into it; Tab stays among its controls
 * instead of wandering to the page behind; when it closes, focus returns to where it was.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary';

/** The ref goes on the dialog's element, which also needs `tabIndex={-1}` to take focus itself. */
export function useDialog(open: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
