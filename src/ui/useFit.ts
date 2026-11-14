/**
 * For a toolbar whose content may not fit (a narrow window, longer words in another language): gives a ref
 * for the bar and a level that rises for as long as the bar's content overflows it. The caller leaves out
 * its least needed items as the level goes up. The level starts again from 0 when the window is resized or
 * `resetKey` changes (the language, or anything else that changes what the bar holds).
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useFit(maxLevel: number, resetKey: string): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ level: 0, key: resetKey });
  const level = state.key === resetKey ? state.level : 0;

  // Runs after every render, before the browser paints: the bar is never shown overflowing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (state.key !== resetKey) {
      setState({ level: 0, key: resetKey });
      return;
    }
    // scrollWidth is a whole number of pixels and may read one too many for content that fits, so it is only
    // trusted from two pixels up; the bar's last item is measured exactly.
    const lastEdge = el.lastElementChild?.getBoundingClientRect().right ?? 0;
    const overflows = el.scrollWidth > el.clientWidth + 1 || lastEdge > el.getBoundingClientRect().right + 0.5;
    if (level < maxLevel && overflows) setState({ level: level + 1, key: resetKey });
  });

  useEffect(() => {
    const onResize = (): void => setState((s) => ({ level: 0, key: s.key }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return [ref, level];
}
