import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Selects the text of an input or any element so the user can copy it by hand. */
function selectText(targetId: string) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Copies `text` and confirms it in place and through a live region (WCAG 4.1.3).
 * The Clipboard API only exists in secure contexts, so on plain http to a LAN
 * address it is unavailable; the text of `targetId` is then selected instead.
 */
export function CopyButton({ text, what, targetId }: { text: string; what: string; targetId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      selectText(targetId);
      setState('manual');
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy} aria-label={`Copy ${what}`}>
        {state === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span className="visually-hidden" role="status">
        {state === 'copied' && `${what} copied`}
        {state === 'manual' && `Couldn't copy automatically; the ${what} is selected, copy it with your keyboard.`}
      </span>
    </>
  );
}
