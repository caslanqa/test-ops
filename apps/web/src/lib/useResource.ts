import { useCallback, useEffect, useState, type DependencyList } from 'react';

interface ResourceState<T> {
  data: T | undefined;
  error: string | null;
}

/**
 * Manages a GET request for the component's lifetime: loading/error state and
 * `reload`. When dependencies change, the stale request's response is ignored, so
 * fast page switches never render the wrong project's data.
 */
export function useResource<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<ResourceState<T>>({
    data: undefined,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            data: prev.data,
            error: err instanceof Error ? err.message : "Couldn't load data",
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated on every render; the caller's dependencies are used as the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    data: state.data,
    error: state.error,
    loading: state.data === undefined && state.error === null,
    reload,
  };
}

/** Sets the page title to "<title> – TestOps" (WCAG 2.4.2, SPA route announcement). */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – TestOps` : 'TestOps';
  }, [title]);
}
