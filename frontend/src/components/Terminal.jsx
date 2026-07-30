/**
 * Terminal.jsx — Phase 7 interactive execution terminal
 *
 * Replaces OutputPanel as the Editor's Run output area. Where
 * OutputPanel rendered a single buffered stdout/stderr result once a
 * request/response execution finished, this renders a live xterm.js
 * terminal wired to an interactive execution session
 * (useTerminalSession.js -> services/terminalSocket.js ->
 * backend/src/socket/terminalSocket.js -> executionSession.service.js):
 * output streams in as it's produced, and keystrokes typed here are
 * forwarded into the running container's stdin (Scanner/input()/cin/
 * readline/fmt.Scan all just work, the same as a real terminal).
 *
 * Run/Stop themselves are NOT rendered here — Navbar already owns that
 * single button (Phase 7 upgraded it to double as Stop while running,
 * see Navbar.jsx). This component exposes `run`/`stop` imperatively via
 * `ref` so Editor.jsx's existing handleRun/handleStop can drive it, and
 * reports `running` back up via `onRunningChange` so Navbar's button
 * label/behavior stays in sync — avoiding two separate Run controls
 * that could fall out of sync with each other.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *   open            {boolean}   — whether the panel body is expanded
 *   onToggle        {Function}  — called when the header is clicked
 *   getRunContext   {Function}  — () => { language, code, projectId } | null,
 *                                  called at the moment Run is actually
 *                                  clicked (same "resolve fresh, not at
 *                                  render time" pattern as
 *                                  useEditorContext.getEditorContext) —
 *                                  returning null/no code aborts silently.
 *   onRunningChange {Function?} — called with the new running boolean
 *                                  whenever it changes
 *   defaultHeight/minHeight/maxHeight — same resizable-panel contract
 *     as OutputPanel had, so Editor.jsx's layout doesn't need to change.
 *
 * ── Imperative handle (via ref) ──────────────────────────────────────
 *   run()   — starts a session for the editor's current content
 *   stop()  — stops whatever session is currently running
 */

import React, {
  forwardRef, useImperativeHandle, useEffect, useRef, useState, useCallback,
} from 'react';
import '@xterm/xterm/css/xterm.css';
import styles from './Terminal.module.css';
import { useTerminalSession } from '../hooks/useTerminalSession.js';

const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 560;

const ChevronIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const Spinner = ({ size = 11 }) => (
  <svg className={styles.spinner} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

function formatElapsed(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const Terminal = forwardRef(function Terminal({
  open,
  onToggle,
  getRunContext,
  onRunningChange,
  defaultHeight = DEFAULT_HEIGHT,
  minHeight = MIN_HEIGHT,
  maxHeight = MAX_HEIGHT,
}, ref) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const runStartRef = useRef(null);
  const [elapsedMs, setElapsedMs] = useState(null);

  const [height, setHeight] = useState(defaultHeight);
  const dragRef = useRef({ active: false, startY: 0, startHeight: 0, lastHeight: defaultHeight });

  const writeOutput = useCallback((data) => {
    termRef.current?.write(data);
  }, []);

  const { running, connecting, lastExit, error, run, sendInput, resize, stop } =
    useTerminalSession({ onOutput: writeOutput });

  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  /* ── Mount xterm.js (dynamic import - same convention as
     socket.io-client/yjs elsewhere in this app: keeps a sizeable
     client library out of the initial bundle). ── */
  useEffect(() => {
    let disposed = false;
    let term;
    let resizeObserver;

    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      term = new XTerm({
        convertEol: true,
        cursorBlink: true,
        scrollback: 5000,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
        theme: {
          background: '#080B14',
          foreground: '#E2E8F0',
          cursor: '#3B82F6',
          selectionBackground: 'rgba(59, 130, 246, 0.35)',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      /* The panel starts collapsed (height: 0 - see the always-mounted
         body div below), so this first fit() may run against a
         zero-size container. The `open`-driven effect further down
         re-fits (via requestAnimationFrame) once the panel actually
         has real dimensions, so this is just best-effort. */
      try {
        fitAddon.fit();
      } catch {
        /* zero-size container at mount - ignore, re-fit on open */
      }

      /* Every keystroke (including control sequences like Ctrl+C /
         arrow keys - xterm.js already encodes those correctly) goes
         straight to the container's stdin. This is what makes
         Scanner/input()/cin/readline/fmt.Scan all work identically to
         a real terminal - the program just reads from its own stdin,
         with no special-casing needed per language. */
      term.onData((data) => {
        sendInputRef.current(data);
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          resizeRef.current(term.cols, term.rows);
        } catch {
          /* Container mid-unmount or momentarily zero-sized - ignore,
             the next resize/fit will correct it. */
        }
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  /* Re-fit whenever the panel is opened or its height changes - a
     hidden (display:none-ish) or zero-height container can't measure
     itself correctly, so this must happen after layout settles. */
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        const term = termRef.current;
        if (term) resizeRef.current(term.cols, term.rows);
      } catch {
        /* ignore - a subsequent resize will correct it */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open, height]);

  const handleRun = useCallback(() => {
    if (running) return;
    const ctx = getRunContext?.();
    if (!ctx || !ctx.code) return;
    termRef.current?.clear();
    runStartRef.current = Date.now();
    setElapsedMs(null);
    run(ctx.language, ctx.code, ctx.projectId);
  }, [running, getRunContext, run]);

  const handleClear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  useImperativeHandle(ref, () => ({
    run: handleRun,
    stop,
  }), [handleRun, stop]);

  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  useEffect(() => {
    if (!running && runStartRef.current != null) {
      setElapsedMs(Date.now() - runStartRef.current);
      runStartRef.current = null;
    }
  }, [running]);

  /* ── Resize handle (top edge) - same pointer-drag + arrow-key
     pattern OutputPanel used, kept local here rather than extracted
     into a shared hook (useResizablePanel.js is horizontal-only, for
     the left/right sidebars). ── */
  const handlePointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = drag.startY - clientY;
    const newHeight = Math.min(maxHeight, Math.max(minHeight, drag.startHeight + delta));
    dragRef.current.lastHeight = newHeight;
    setHeight(newHeight);
  }, [minHeight, maxHeight]);

  const handlePointerUp = useCallback(() => {
    dragRef.current.active = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchmove', handlePointerMove);
    document.removeEventListener('touchend', handlePointerUp);
  }, [handlePointerMove]);

  function handlePointerDown(e) {
    if (!open) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { active: true, startY: clientY, startHeight: height, lastHeight: height };
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', handlePointerMove);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchmove', handlePointerMove, { passive: false });
    document.addEventListener('touchend', handlePointerUp);
  }

  function handleHandleKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHeight((h) => Math.min(maxHeight, h + 16));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHeight((h) => Math.max(minHeight, h - 16));
    }
  }

  const statusDot = connecting
    ? styles.dot_connecting
    : running
    ? styles.dot_running
    : error
    ? styles.dot_error
    : lastExit && lastExit.exitCode === 0
    ? styles.dot_success
    : lastExit
    ? styles.dot_error
    : styles.dot_idle;

  return (
    <div className={`${styles.panel} ${open ? styles.panel_open : ''}`}>
      {open && (
        <div
          className={styles.resize_handle}
          onMouseDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          onKeyDown={handleHandleKeyDown}
          tabIndex={0}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
        >
          <span className={styles.grip} />
        </div>
      )}

      <div className={styles.header} onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); } }}>
        <div className={styles.header_left}>
          <span className={`${styles.chevron} ${open ? styles.chevron_open : ''}`}>
            <ChevronIcon />
          </span>
          <span className={`${styles.status_dot} ${statusDot}`} />
          <span className={styles.title}>Terminal</span>
          {running && <Spinner />}
        </div>

        <div className={styles.header_right} onClick={(e) => e.stopPropagation()}>
          {!running && lastExit && (
            <span className={`${styles.badge} ${lastExit.exitCode === 0 ? styles.badge_success : styles.badge_error}`}>
              {lastExit.exitCode === 0 ? '✓' : '✗'} exit {lastExit.exitCode ?? '—'}
              {elapsedMs != null && ` · ${formatElapsed(elapsedMs)}`}
            </span>
          )}
          {error && <span className={styles.error_text}>{error}</span>}

          <button className={styles.icon_btn} onClick={handleClear} title="Clear terminal">
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Always rendered (never conditionally mounted on `open`) - the
          xterm.js mount effect above runs once, on this component's
          own mount, and needs containerRef.current to already exist in
          the DOM at that point. Conditionally rendering this on `open`
          (which starts false) would mean containerRef.current is still
          null when that effect runs, so xterm.js would never actually
          get created - visibility is toggled with CSS instead, so the
          terminal (and its scrollback/session) persists across
          collapse/expand rather than being torn down and recreated. */}
      <div className={`${styles.body} ${!open ? styles.body_collapsed : ''}`} style={{ height: open ? height : 0 }}>
        <div ref={containerRef} className={styles.xterm_container} />
      </div>
    </div>
  );
});

export default Terminal;
