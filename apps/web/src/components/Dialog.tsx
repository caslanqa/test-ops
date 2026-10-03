import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Wider dialog for wide content (e.g. case selection). */
  wide?: boolean;
}

/**
 * Native <dialog> + showModal(): the focus trap, closing with Esc, an inert
 * backdrop and focus returning to the trigger on close all come from the browser
 * (a11y K3/K7). That is why a native element is used instead of a custom modal.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
    >
      <header className="dialog-header">
        <div>
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="dialog-description">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {open && children}
    </dialog>
  );
}
