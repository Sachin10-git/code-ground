/**
 * OutputPanel.jsx — Code Ground execution output / terminal area
 *
 * Shows the result of running code in the sandboxed Docker container:
 * stdout (green, line-numbered), stderr (red, line-numbered), a
 * status badge with total execution time, and controls to copy or
 * clear the output.
 *
 * ── What this component does ────────────────────────────────────────
 *
 *   1. Collapsible header — click to expand/collapse the output area.
 *      Shows a status dot (idle / running / success / error), the
 *      word "Output", and either a running spinner or a badge with
 *      ✓/✗ and the total elapsed time (e.g. "✓ 312ms" or "✓ 1.24s").
 *
 *   2. Terminal-style body — stdout and stderr are each rendered with
 *      line numbers in a dim gutter, like a real terminal / editor.
 *      stdout lines are green, stderr lines are red.
 *
 *   3. Strips ANSI colour escape codes (e.g. "\x1b[32m") from output
 *      so raw escape sequences never leak into the UI as garbage text.
 *
 *   4. Truncates extremely long output (>2000 lines) with a note,
 *      so a runaway `print` loop can't freeze the page.
 *
 *   5. Copy button — copies stdout + stderr combined to the clipboard.
 *      Clear button — calls onClear so the parent can reset output to null.
 *
 *   6. RESIZABLE — a drag handle on the top edge of the panel lets the
 *      user resize the terminal area, like VS Code's integrated terminal.
 *      Also keyboard-accessible: focus the handle, use ↑/↓ to resize.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   output          {Object|null} — { stdout, stderr, elapsed_ms, success,
 *                                      exit_code? } or null if nothing run yet
 *   running         {boolean}     — true while a POST /execute is in flight
 *   open            {boolean}     — whether the panel body is expanded
 *   onToggle        {Function}    — called when the header is clicked
 *   onClear         {Function?}   — called when the Clear button is clicked.
 *                                    If omitted, the Clear button is hidden.
 *   defaultHeight   {number}      — initial body height in px (default 180)
 *   minHeight       {number}      — minimum body height in px (default 80)
 *   maxHeight       {number}      — maximum body height in px (default 480)
 *   onHeightChange  {Function?}   — called with the new height as the user
 *                                    drags the resize handle (optional —
 *                                    use this to persist the height)
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   import OutputPanel from '../components/OutputPanel.jsx';
 *
 *   <OutputPanel
 *     output={output}
 *     running={running}
 *     open={outputOpen}
 *     onToggle={() => setOutputOpen(o => !o)}
 *     onClear={() => setOutput(null)}
 *   />
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './OutputPanel.module.css';

/* ─────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────── */

/* Strip ANSI colour/style escape codes — e.g. "\x1b[32mHello\x1b[0m" */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/* Cap rendered lines so a runaway print loop can't freeze the page */
const MAX_LINES = 2000;

/* ─────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────── */

/** Remove ANSI escape sequences from a string. */
function stripAnsi(text = '') {
  return text.replace(ANSI_RE, '');
}

/**
 * formatElapsed — "312ms" for sub-second, "1.24s" for a second or more.
 * Keeps the badge readable for both fast scripts and slower compiles.
 */
function formatElapsed(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, inherit currentColor
───────────────────────────────────────────────────────────────────── */

const ChevronIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

/* Spinner — spinning arc */
const Spinner = ({ size = 11 }) => (
  <svg className={styles.spinner} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   STREAM — renders one of stdout / stderr as line-numbered terminal text.

   - Splits on '\n', drops a single trailing empty line (from a final \n)
   - Each line gets a number in the gutter + the line content
   - Empty lines render a non-breaking space so they stay visible
   - Truncates at MAX_LINES with a note showing how many lines were hidden
───────────────────────────────────────────────────────────────────── */
function Stream({ text, variant }) {
  const clean = stripAnsi(text);
  const lines = clean.split('\n');

  /* A trailing newline produces one empty string at the end — drop it
     so we don't show a phantom extra "line N" with nothing in it. */
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  const truncated = lines.length > MAX_LINES;
  const shown     = truncated ? lines.slice(0, MAX_LINES) : lines;

  return (
    <div className={styles.stream}>
      {/* Label — "stdout" or "stderr" — small, mono, dim */}
      <div className={`${styles.stream_label} ${styles[`label_${variant}`]}`}>
        {variant}
      </div>

      <div className={styles.lines}>
        {shown.map((line, i) => (
          <div key={i} className={styles.line}>
            <span className={styles.line_num}>{i + 1}</span>
            <span className={`${styles.line_text} ${styles[`text_${variant}`]}`}>
              {line === '' ? '\u00A0' : line}
            </span>
          </div>
        ))}
      </div>

      {truncated && (
        <div className={styles.truncated_note}>
          {/* Mono comment style — matches the brand voice */}
          // output truncated — {lines.length - MAX_LINES} more {lines.length - MAX_LINES === 1 ? 'line' : 'lines'} hidden
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   OUTPUT PANEL — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function OutputPanel({
  output,
  running,
  open,
  onToggle,
  onClear,
  defaultHeight  = 180,
  minHeight      = 80,
  maxHeight      = 480,
  onHeightChange,
}) {
  /* ── Body height (resizable) ── */
  const [height, setHeight] = useState(defaultHeight);

  /* ── Copy feedback ── */
  const [copied, setCopied] = useState(false);

  /* ── Refs ── */
  const bodyRef  = useRef(null);
  const dragRef  = useRef({ active: false, startY: 0, startHeight: 0 });

  /* Scroll to top whenever a new result arrives — most relevant
     output (the result, errors) is usually near the start for
     short scripts; users can scroll down for long output. */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [output]);

  /* ── Resize: pointer drag on the top handle ──
     We track drag state in a ref (not state) so the mousemove
     handler doesn't trigger re-renders on every pixel — only
     the final height update does. */
  const handlePointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    /* Handle is on the TOP edge of the panel. Dragging UP (negative
       delta) should INCREASE height; dragging DOWN decreases it. */
    const delta    = drag.startY - clientY;
    const newHeight = Math.min(maxHeight, Math.max(minHeight, drag.startHeight + delta));

    setHeight(newHeight);
  }, [minHeight, maxHeight]);

  const handlePointerUp = useCallback(() => {
    dragRef.current.active = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchmove', handlePointerMove);
    document.removeEventListener('touchend', handlePointerUp);

    /* Notify parent of the final height, if they care */
    onHeightChange?.(dragRef.current.lastHeight);
  }, [handlePointerMove, onHeightChange]);

  function handlePointerDown(e) {
    /* Only resize while the panel is open — collapsed panels
       don't have a body to resize. */
    if (!open) return;

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { active: true, startY: clientY, startHeight: height };
    document.body.style.cursor = 'row-resize';

    document.addEventListener('mousemove', handlePointerMove);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchmove', handlePointerMove, { passive: false });
    document.addEventListener('touchend', handlePointerUp);
  }

  /* Keep dragRef.lastHeight in sync so handlePointerUp can report it */
  useEffect(() => {
    dragRef.current.lastHeight = height;
  }, [height]);

  /* ── Keyboard resize — focus the handle, press ↑/↓ ── */
  function handleHandleKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHeight(h => {
        const next = Math.min(maxHeight, h + 16);
        onHeightChange?.(next);
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHeight(h => {
        const next = Math.max(minHeight, h - 16);
        onHeightChange?.(next);
        return next;
      });
    }
  }

  /* Clean up any lingering listeners on unmount (e.g. drag mid-flight) */
  useEffect(() => () => {
    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchmove', handlePointerMove);
    document.removeEventListener('touchend', handlePointerUp);
  }, [handlePointerMove, handlePointerUp]);

  /* ── Copy combined output ── */
  function handleCopy(e) {
    e.stopPropagation();
    const combined = [output?.stdout, output?.stderr].filter(Boolean).join('\n');
    navigator.clipboard.writeText(stripAnsi(combined)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  /* ── Clear output ── */
  function handleClear(e) {
    e.stopPropagation();
    onClear?.();
  }

  /* ── Derived status for the header dot/badge ── */
  const status =
    running          ? 'running' :
    output?.success  ? 'ok' :
    output           ? 'err' :
                        'idle';

  const hasOutput = !!(output?.stdout || output?.stderr);

  return (
    <div
      className={`${styles.panel} ${open ? styles.panel_open : ''}`}
      style={open ? { '--body-height': `${height}px` } : undefined}
    >

      {/* ── Resize handle — only meaningful when open ── */}
      {open && (
        <div
          className={styles.resize_handle}
          onMouseDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          onKeyDown={handleHandleKeyDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize output panel"
          aria-valuenow={height}
          aria-valuemin={minHeight}
          aria-valuemax={maxHeight}
          tabIndex={0}
        >
          {/* Visual grip dots */}
          <span className={styles.grip} aria-hidden="true" />
        </div>
      )}

      {/* ── Header ── */}
      <div className={styles.header}>

        {/* Toggle — status dot, title, badge/spinner, chevron */}
        <button
          className={styles.header_toggle}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="output-panel-body"
        >
          <span className={`${styles.status_dot} ${styles[`dot_${status}`]}`} aria-hidden="true" />
          <span className={styles.title}>Output</span>

          {running && (
            <span className={styles.running_label}>
              <Spinner /> running…
            </span>
          )}

          {!running && output && (
            <span className={`${styles.badge} ${output.success ? styles.badge_ok : styles.badge_err}`}>
              {output.success ? '✓' : '✗'} {formatElapsed(output.elapsed_ms)}
              {/* Exit code — only shown if the backend provides it */}
              {typeof output.exit_code === 'number' && output.exit_code !== 0 && (
                <span className={styles.exit_code}> · exit {output.exit_code}</span>
              )}
            </span>
          )}

          <span className={`${styles.chevron} ${open ? styles.chevron_open : ''}`} aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>

        {/* Actions — Copy / Clear. Only shown when there's something to act on. */}
        {open && hasOutput && (
          <div className={styles.actions}>
            <button className={styles.action_btn} onClick={handleCopy} aria-label="Copy output">
              <CopyIcon />
              {copied ? 'Copied!' : 'Copy'}
            </button>
            {onClear && (
              <button className={styles.action_btn} onClick={handleClear} aria-label="Clear output">
                <TrashIcon />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      {open && (
        <div id="output-panel-body" ref={bodyRef} className={styles.body}>

          {/* Idle — nothing run yet */}
          {!output && !running && (
            <p className={styles.placeholder}>
              <span className={styles.comment}>// press Run to execute your code</span>
            </p>
          )}

          {/* Running — nothing returned yet */}
          {running && !output && (
            <p className={styles.placeholder}>
              <span className={styles.comment}>// running your code</span>
              <span className={styles.run_cursor} aria-hidden="true">▋</span>
            </p>
          )}

          {/* stdout */}
          {output?.stdout && <Stream text={output.stdout} variant="stdout" />}

          {/* stderr */}
          {output?.stderr && <Stream text={output.stderr} variant="stderr" />}

          {/* Completed but produced no output at all */}
          {output && !output.stdout && !output.stderr && (
            <p className={styles.placeholder}>
              <span className={styles.comment}>
                // {output.success ? 'program finished with no output' : 'execution failed with no output'}
              </span>
            </p>
          )}

        </div>
      )}
    </div>
  );
}
