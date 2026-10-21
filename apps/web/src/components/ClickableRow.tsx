import type { MouseEvent, ReactNode } from 'react';

/** Makes the rest of a table row activate its existing primary link or disclosure. */
export function ClickableRow({
  children,
  className,
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Keep nested controls and links independent from the row's primary action.
    if (target.closest('a, button, input, select, textarea, [role="button"], [role="link"]')) return;

    const primaryAction = event.currentTarget.querySelector<HTMLElement>('.row-link, .row-button');
    primaryAction?.click();
  }

  return (
    <tr
      className={[enabled && 'clickable-row', className].filter(Boolean).join(' ')}
      onClick={enabled ? onClick : undefined}
    >
      {children}
    </tr>
  );
}
