/**
 * hooks/useResizablePanel.js — Phase 6.3.5: draggable panel width
 *
 * Shared by both resizable panels in Editor.jsx (the left sidebar and
 * the AI chat panel) — same min/default/max-width + drag + persist
 * + double-click-reset behaviour, parameterized by which side of the
 * panel its resize handle sits on.
 *
 * `edge`:
 *   'right' — handle on the panel's right edge (the left sidebar):
 *             dragging the handle right GROWS the panel.
 *   'left'  — handle on the panel's left edge (the AI chat panel,
 *             which sits on the right side of the screen): dragging
 *             the handle right SHRINKS the panel (its left boundary
 *             is moving toward its own right boundary).
 *
 * Width is persisted to localStorage on drag *end* (and on
 * double-click reset), not on every pointermove — writing on every
 * frame of a drag would be needless localStorage churn for no benefit
 * (nothing reads the stored value again until the next page load).
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export function useResizablePanel({
  storageKey, defaultWidth, minWidth, maxWidth, edge = 'right',
}) {
  const sign = edge === 'right' ? 1 : -1;

  const [width, setWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) {
      return Math.min(maxWidth, Math.max(minWidth, stored));
    }
    return defaultWidth;
  });

  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef(null); // { startX, startWidth } | null

  const clamp = useCallback(
    (w) => Math.min(maxWidth, Math.max(minWidth, w)),
    [minWidth, maxWidth],
  );

  /* Persist only once a drag session ends (or on a reset — a plain
     width change while `dragging` is false), never mid-drag. */
  useEffect(() => {
    if (dragging) return;
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width, dragging]);

  useEffect(() => {
    if (!dragging) return;

    function onMove(e) {
      const state = dragStateRef.current;
      if (!state) return;
      const delta = (e.clientX - state.startX) * sign;
      setWidth(clamp(state.startWidth + delta));
    }
    function onUp() {
      setDragging(false);
      dragStateRef.current = null;
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    /* Force the resize cursor for the whole page during the drag —
       without this, the cursor flickers back to default the instant
       the pointer crosses off the (few-pixel-wide) handle itself. */
    const prevCursor     = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging, sign, clamp]);

  const onHandlePointerDown = useCallback((e) => {
    /* Left button only — ignore right/middle click on the handle. */
    if (e.button !== 0) return;
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  }, [width]);

  const reset = useCallback(() => setWidth(defaultWidth), [defaultWidth]);

  return { width, dragging, onHandlePointerDown, onHandleDoubleClick: reset, reset };
}

export default useResizablePanel;
