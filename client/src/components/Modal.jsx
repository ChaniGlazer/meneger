import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * One modal implementation for the whole app (previously duplicated between
 * a "generic" modal and an admin-only one with slightly different markup).
 * Handles Escape-to-close, a focus trap, focus restore to whatever triggered
 * it, and locking background scroll while open.
 *
 * Pass `onSubmit` to render the panel itself as a <form> (for single-form
 * modals like "new chat"); omit it for modals with an independent form
 * section nested inside (like "manage group members").
 */
export default function Modal({ open, onClose, onSubmit, title, children, maxWidth }) {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const onCloseRef = useRef(onClose);

  // Keep the ref current without making it a dependency of the effect below -
  // callers pass a new `onClose` function identity on every render (inline
  // arrows, or plain functions redefined each render), and depending on it
  // directly re-ran the effect on every keystroke in any field inside the
  // modal, which stole focus back to the first focusable element (the close
  // button) after every character typed.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    panel?.querySelector(FOCUSABLE_SELECTOR)?.focus();

    function getFocusable() {
      if (!panel) return [];
      return [...panel.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      triggerRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const PanelTag = onSubmit ? "form" : "div";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <PanelTag
        className="modal-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title-heading"
        onSubmit={onSubmit}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="modal-head">
          <h3 id="modal-title-heading">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>
        {children}
      </PanelTag>
    </div>
  );
}
