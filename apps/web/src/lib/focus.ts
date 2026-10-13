import { useCallback, useEffect, useRef } from 'react';

/** Moves focus to the page's h1 (it has tabIndex -1), the fallback when a row or panel is removed. */
export function focusPageHeading(): void {
  document.querySelector<HTMLElement>('.page-heading h1')?.focus();
}

/**
 * Keeps keyboard focus from falling to <body> when the control that was used disappears with
 * the action's result (a row that was archived or deleted, a panel that closed). Call the
 * returned `request` before the action; once `data` (the reloaded list) changes, focus moves
 * to `getTarget()` (the page heading by default) if nothing is focused anymore. Focus that
 * is still somewhere useful, e.g. on a button that survived the update, is left alone.
 */
export function useFocusFallback(
  data: unknown,
  getTarget: () => HTMLElement | null = () =>
    document.querySelector<HTMLElement>('.page-heading h1'),
): () => void {
  const pending = useRef(false);
  const targetRef = useRef(getTarget);
  useEffect(() => {
    targetRef.current = getTarget;
  });

  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    // One frame later, so that a dialog closing at the same time has restored its own focus first.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) targetRef.current()?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);

  return useCallback(() => {
    pending.current = true;
  }, []);
}
