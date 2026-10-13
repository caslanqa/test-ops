import { createContext, useContext } from 'react';

export interface NoticeContent {
  text: string;
  /** Optional follow-up link shown next to the message. */
  link?: { to: string; label: string };
}

export interface NoticeApi {
  /** Shows `text` in the live region at the bottom of the screen and announces it (WCAG 4.1.3). */
  /** `survivesNavigation`: the action navigates away right after (deleting the open page's record); the message moves with it. */
  notify: (text: string, link?: NoticeContent['link'], survivesNavigation?: boolean) => void;
  dismiss: () => void;
}

export const NoticeContext = createContext<NoticeApi | null>(null);

/** Announces results of actions ("Plan archived.") on any page, also across a route change. */
export function useNotice(): NoticeApi {
  const api = useContext(NoticeContext);
  if (!api) throw new Error('useNotice must be used inside <NoticeProvider>');
  return api;
}
