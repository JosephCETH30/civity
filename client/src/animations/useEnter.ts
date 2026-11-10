import { useLayoutEffect, type RefObject } from 'react';
import gsap from 'gsap';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Staggered entrance for `[data-enter]` children (or the element itself). Cleans up on unmount; no-op for reduced motion. */
export function useEnter(ref: RefObject<HTMLElement | null>, opts: { y?: number; x?: number; stagger?: number; deps?: unknown[] } = {}) {
  useLayoutEffect(() => {
    if (!ref.current || reduced()) return;
    const ctx = gsap.context(() => {
      const items = ref.current!.querySelectorAll('[data-enter]');
      gsap.from(items.length ? items : ref.current!, {
        opacity: 0, y: opts.y ?? 12, x: opts.x ?? 0, duration: 0.45, ease: 'power2.out', stagger: opts.stagger ?? 0.05, clearProps: 'all',
      });
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps ?? []);
}
