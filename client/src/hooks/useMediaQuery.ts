import { useSyncExternalStore } from 'react';

export function useMediaQuery(q: string) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => matchMedia(q).matches,
  );
}
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
