import { useId, useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
import { FormError } from './Page';

interface TypeToConfirmProps {
  /** The exact text to type: the workspace's name or the project's key. The server checks it too. */
  expected: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * Confirmation for deleting something for good: the delete button works only after the person
 * types the record's name or key, so a slip of the mouse can't erase it.
 */
export function TypeToConfirmDialog({
  open,
  title,
  message,
  ...props
}: TypeToConfirmProps & { open: boolean; title: string; message: string }) {
  return (
    <Dialog open={open} onClose={props.onClose} title={title} description={message}>
      {/* Mounted only while open, so the typed text starts empty every time. */}
      {open && <TypeToConfirmForm {...props} />}
    </Dialog>
  );
}

function TypeToConfirmForm({ expected, confirmLabel, onConfirm, onClose }: TypeToConfirmProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const matches = typed === expected;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete it");
      setBusy(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={inputId} className="field-label">
          Type <strong className="mono">{expected}</strong> to confirm
        </label>
        <input
          id={inputId}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-danger" disabled={busy || !matches}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}
