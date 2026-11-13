"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared focus-trap protocol used by every modal in the app:
 * Tab/Shift+Tab cycle inside `panelRef`, Escape calls the LATEST `onClose`
 * (held in a ref so the keydown handler never goes stale), body scroll is
 * locked while mounted, and focus returns to the previously focused element
 * on unmount. `onClose` may be omitted for must-acknowledge gates (Escape is
 * then ignored).
 */
function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  onClose?: () => void
) {
  const restoreRef = useRef<Element | null>(null);
  // Latest-onClose ref: the keydown listener is bound once on mount, so it
  // must read the handler through a ref or it would close over the FIRST
  // onClose prop forever.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    // Focus the first focusable element (or the panel itself).
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === firstEl || !panel.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !panel.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Focus-trap modal shell: Tab cycles inside, Escape closes when `onClose`
 * is provided (omit for must-acknowledge gates), body scroll is locked while
 * mounted, and focus returns to the previously focused element on unmount.
 */
export function FocusTrapModal({
  labelledBy,
  onClose,
  className,
  overlayClassName,
  children,
}: {
  /** id of the element labelling the dialog */
  labelledBy: string;
  onClose?: () => void;
  className?: string;
  overlayClassName?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(panelRef, onClose);

  return (
    <div
      id={id}
      className={overlayClassName ?? "fixed inset-0 z-[85] grid place-items-center bg-[var(--ink)]/85 backdrop-blur-sm p-6"}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`outline-none ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}
