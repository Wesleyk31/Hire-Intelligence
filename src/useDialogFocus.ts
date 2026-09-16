import { useEffect, useRef } from 'react';

// Keep keyboard navigation inside an open modal and return focus to its opener.
export function useDialogFocus(open: boolean, close: () => void) {
  const container = useRef<HTMLElement | null>(null);
  const onClose = useRef(close);
  onClose.current = close;

  useEffect(() => {
    const element = container.current;
    if (!open || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter(item => item.getClientRects().length > 0);
    (focusable()[0] || element).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); element.focus(); return; }
        if (!element.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return container;
}
