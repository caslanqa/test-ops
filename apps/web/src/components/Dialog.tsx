import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Geniş içerik (ör. case seçimi) için daha geniş dialog. */
  wide?: boolean;
}

/**
 * Native <dialog> + showModal(): odak tuzağı, Esc ile kapanma, arka planın
 * inert olması ve kapanınca odağın tetikleyen öğeye dönmesi tarayıcıdan gelir
 * (a11y K3/K7). Bu yüzden özel bir modal yerine native element kullanılır.
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
          aria-label="Kapat"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {open && children}
    </dialog>
  );
}
