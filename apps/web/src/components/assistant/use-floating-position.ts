'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Where the floating assistant button sits, so it can be dragged off whatever
 * it was covering. Held as distances from the right and bottom edges, so it
 * stays in its corner when the window is resized; kept within the window, and
 * remembered in this browser (localStorage).
 *
 * A press that moves less than a few pixels is still a click. Shift + arrow
 * keys move the button when it has focus.
 */

const SIZE = 56; // h-14 w-14
const MARGIN = 8;
const DEFAULT = { right: 24, bottom: 24 };
const STORE_KEY = 'assistant.floating.position';
const DRAG_THRESHOLD = 5;
const KEY_STEP = 24;

export interface FloatingPosition {
  right: number;
  bottom: number;
}

function clamp(p: FloatingPosition): FloatingPosition {
  if (typeof window === 'undefined') return p;
  const maxRight = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxBottom = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return {
    right: Math.round(Math.min(Math.max(p.right, MARGIN), maxRight)),
    bottom: Math.round(Math.min(Math.max(p.bottom, MARGIN), maxBottom)),
  };
}

function load(): FloatingPosition {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<FloatingPosition>) : null;
    if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) return clamp(p as FloatingPosition);
  } catch {
    // fall through to the default corner
  }
  return clamp(DEFAULT);
}

function store(p: FloatingPosition | null) {
  try {
    if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Not remembered; it still moves for this page view.
  }
}

export function useFloatingPosition() {
  const [pos, setPos] = useState<FloatingPosition>(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [wide, setWide] = useState(false);
  const drag = useRef<{ x: number; y: number; start: FloatingPosition; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setPos(load());
    const mq = window.matchMedia('(min-width: 640px)');
    const update = () => {
      setWide(mq.matches);
      setPos((p) => clamp(p));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, start: pos, moved: false, id: e.pointerId };
      // Captured at once: a quick drag leaves the button before the first move event, and the
      // rest of the gesture would otherwise go to whatever is underneath.
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp({ right: d.start.right - dx, bottom: d.start.bottom - dy }));
  }, []);

  const endDrag = useCallback((e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      // The click that follows a drag must not open or close the panel.
      suppressClick.current = true;
      setDragging(false);
      setPos((p) => {
        store(p);
        return p;
      });
    }
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (!e.shiftKey) return;
    const delta = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] }[e.key];
    if (!delta) return;
    e.preventDefault();
    setPos((p) => {
      const next = clamp({ right: p.right + delta[0], bottom: p.bottom + delta[1] });
      store(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const p = clamp(DEFAULT);
    setPos(p);
    store(null);
  }, []);

  /** True once for the click event that ends a drag; the caller ignores that click. */
  const consumeDragClick = useCallback(() => {
    const was = suppressClick.current;
    suppressClick.current = false;
    return was;
  }, []);

  const buttonStyle: CSSProperties = { right: pos.right, bottom: pos.bottom, touchAction: 'none' };

  /**
   * Wide screens: the panel opens beside the button, on whichever side has
   * room - towards the middle of the window. Phones: the panel is full screen
   * (no style, the classes do it).
   */
  const panelStyle = (): CSSProperties | undefined => {
    if (!wide || typeof window === 'undefined') return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(420, vw - 2 * MARGIN - 16);
    const left = vw - pos.right - SIZE;
    const top = vh - pos.bottom - SIZE;
    const style: CSSProperties = { width, inset: 'auto' };
    if (left + SIZE / 2 > vw / 2) style.right = Math.max(MARGIN, Math.min(pos.right, vw - width - MARGIN));
    else style.left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
    const gap = 16;
    if (top + SIZE / 2 > vh / 2) {
      // Button in the lower half: the panel sits above it.
      style.bottom = pos.bottom + SIZE + gap;
      style.height = Math.min(640, vh - (pos.bottom + SIZE + gap) - MARGIN);
    } else {
      style.top = top + SIZE + gap;
      style.height = Math.min(640, vh - (top + SIZE + gap) - MARGIN);
    }
    style.height = Math.max(280, style.height as number);
    return style;
  };

  return {
    dragging,
    buttonStyle,
    panelStyle,
    consumeDragClick,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown },
  };
}
