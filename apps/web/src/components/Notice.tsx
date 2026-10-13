import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { NoticeContext, type NoticeContent } from '../lib/notice';

/**
 * Owns the single status message of the signed-in app. It stays until dismissed or replaced,
 * and is dropped when the person moves on to another page.
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [notice, setNotice] = useState<(NoticeContent & { path: string | null; survivesNavigation: boolean }) | null>(null);

  const notify = useCallback((text: string, link?: NoticeContent['link'], survivesNavigation = false) => {
    // `path` stays unknown until the page the message belongs to has rendered.
    setNotice({ text, link, path: null, survivesNavigation });
  }, []);
  const dismiss = useCallback(() => setNotice(null), []);

  // Drop the message once the person is on another page than the one it was shown on. State is
  // adjusted while rendering (no effect, no extra paint): `path` is filled in on the first render
  // after notify(). A message flagged `survivesNavigation` moves to the page the action navigates to
  // (the router may commit that a render after the notification, so the first change is let through).
  if (notice && notice.path === null) setNotice({ ...notice, path: pathname });
  else if (notice && notice.path !== pathname) {
    setNotice(notice.survivesNavigation ? { ...notice, path: pathname, survivesNavigation: false } : null);
  }

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  return (
    <NoticeContext.Provider value={api}>
      {children}
      <NoticeRegion notice={notice} onDismiss={dismiss} />
    </NoticeContext.Provider>
  );
}

/**
 * Fixed to the bottom of the screen so the confirmation stays visible wherever in a list the
 * action was taken; role=status also announces it to screen readers without moving focus. The
 * region is always in the DOM: live regions announce content added to an existing element.
 */
function NoticeRegion({ notice, onDismiss }: { notice: NoticeContent | null; onDismiss: () => void }) {
  return (
    <div className="toast-region" role="status">
      {notice && (
        <div className="toast">
          <p>
            {notice.text}{' '}
            {notice.link && <Link to={notice.link.to}>{notice.link.label}</Link>}
          </p>
          <button
            type="button"
            className="icon-button icon-button--on-dark"
            onClick={() => {
              onDismiss();
              // The button disappears with the message; keep keyboard focus on the page.
              document.getElementById('main-content')?.focus();
            }}
            aria-label="Dismiss notification"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
