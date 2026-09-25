import { useEffect, useState } from 'react';

/** Minimal hash router: the app has five places and a meeting page. */
export function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function navigate(to: string): void {
  if (currentPath() !== to) window.location.hash = to;
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function match(path: string, pattern: string): Record<string, string> | null {
  const a = path.split('?')[0]!.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i]!.startsWith(':')) params[b[i]!.slice(1)] = decodeURIComponent(a[i]!);
    else if (b[i] !== a[i]) return null;
  }
  return params;
}

export function queryParam(path: string, key: string): string | null {
  const q = path.split('?')[1];
  return q ? new URLSearchParams(q).get(key) : null;
}
