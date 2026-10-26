import { useEffect, useId, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<Id extends string> {
  id: Id;
  /** The tab's text. A status such as "On" belongs in the text, so it isn't carried by color alone. */
  label: ReactNode;
  panel: ReactNode;
}

/**
 * Tabs with their panels, following the ARIA tabs pattern: the arrow keys, Home and End move between
 * the tabs and select the one they reach, and only the selected tab is in the tab order. Every panel
 * stays mounted and the others are hidden, so what someone typed in a panel is still there when they
 * come back to it.
 */
export function Tabs<Id extends string>({
  label,
  tabs,
  active,
  onChange,
}: {
  /** Names the tab list for screen readers. */
  label: string;
  tabs: TabItem<Id>[];
  active: Id;
  onChange: (id: Id) => void;
}) {
  const base = useId();
  const tabId = (id: string) => `${base}-${id}-tab`;
  const panelId = (id: string) => `${base}-${id}-panel`;

  // A control inside a panel can switch tabs (a link to another tab). Its panel is hidden then and the
  // focus would be lost, so the focus follows to the tab that was selected.
  useEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('[role="tabpanel"][hidden]')) {
      document.getElementById(tabId(active))?.focus();
    }
    // tabId depends on base only, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tabId(tab.id) === (event.target as HTMLElement).id);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    document.getElementById(tabId(tabs[next].id))?.focus();
    onChange(tabs[next].id);
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-controls={panelId(tab.id)}
            aria-selected={tab.id === active}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          tabIndex={0}
          hidden={tab.id !== active}
        >
          {tab.panel}
        </div>
      ))}
    </>
  );
}
