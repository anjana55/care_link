'use client';

import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query matches, kept up to date as the window changes.
 * False during server rendering and the first client render, so markup never
 * differs between the two; layout that must be right from the first paint
 * belongs in CSS breakpoints instead.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}
