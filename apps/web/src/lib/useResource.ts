import { useCallback, useEffect, useState, type DependencyList } from 'react';

interface ResourceState<T> {
  data: T | undefined;
  error: string | null;
}

/**
 * Bir GET isteğini bileşen ömrü boyunca yönetir: yükleniyor/hata durumu ve
 * `reload`. Bağımlılıklar değişince eski isteğin cevabı yok sayılır; böylece
 * hızlı sayfa geçişlerinde yanlış projenin verisi ekrana yazılmaz.
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
    // `load` her render'da yeniden oluşturulur; tetikleyici olarak çağıranın bağımlılıkları kullanılır.
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

/** Sayfa başlığını "<başlık> – TestOps" yapar (WCAG 2.4.2, SPA rota duyurusu). */
export function usePageTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – TestOps` : 'TestOps';
  }, [title]);
}
