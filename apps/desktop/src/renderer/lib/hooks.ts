import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, onAppEvent } from '../api';
import type { AppEvent } from '../../shared/types';

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data and reload it when related app events arrive, so every screen
 * stays current without manual refreshes.
 */
export function useQuery<T>(
  load: () => Promise<T>,
  deps: unknown[],
  reloadOn: AppEvent['type'][] = [],
): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    loadRef.current().then(
      (d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (n !== seq.current) return;
        setError(
          e instanceof ApiError
            ? e.message
            : 'Something went wrong while loading. Please try again.',
        );
        setLoading(false);
      },
    );
  }, []);

  useEffect(reload, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!reloadOn.length) return;
    return onAppEvent((e) => {
      if (reloadOn.includes(e.type)) reload();
    });
  }, [reload, reloadOn.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, reload };
}

export function useAppEvent(listener: (e: AppEvent) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => onAppEvent((e) => ref.current(e)), []);
}

/** Re-render every `ms` milliseconds (for timers). */
export function useTicker(ms: number, active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return n;
}
