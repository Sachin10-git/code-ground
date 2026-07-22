/**
 * useExecution.js — Code Ground code execution hook
 *
 * Extracted from the inline handleRun function in Editor.jsx.
 * Owns the complete execution lifecycle: sending code to the backend
 * sandbox, tracking running state, enforcing a client-side timeout,
 * and exposing the output to the UI.
 *
 * ── What this hook does ──────────────────────────────────────────────
 *
 *   1. Exposes a `run(code, language)` function — call it when the
 *      user clicks Run. It POSTs to POST /execute and stores the
 *      result in `output` state.
 *
 *   2. Tracks `running` (true while a request is in flight) and
 *      `outputOpen` (whether the OutputPanel body is expanded).
 *      `outputOpen` is managed here because it's entirely driven by
 *      execution events: it opens automatically when Run is clicked,
 *      and stays closed until the first run.
 *
 *   3. Enforces a CLIENT-SIDE TIMEOUT. The backend Docker sandbox has
 *      its own timeout (10s free / 30s Pro), but if the backend never
 *      responds at all (network issue, server crash, cold start), the
 *      UI would spin forever. This hook sets a deadline slightly beyond
 *      the backend's max and surfaces a "timed out" error if hit,
 *      giving the user clear feedback to try again.
 *
 *   4. Supports abort — calling `cancel()` stops the in-flight request
 *      immediately via AbortController, the same pattern as useAI.js.
 *      This is the "Stop" button that appears in the Run button while
 *      running (the Navbar already renders this based on the `running`
 *      prop — this hook is what backs it).
 *
 *   5. Tracks client-side elapsed time as a fallback for when the
 *      backend doesn't return `elapsed_ms` (e.g. on a network error).
 *      The output object always has an `elapsed_ms` field so OutputPanel
 *      can render the badge without null-checking.
 *
 * ── Output object shape ──────────────────────────────────────────────
 *
 *   {
 *     stdout:     string,   — standard output from the program
 *     stderr:     string,   — standard error / compiler errors
 *     elapsed_ms: number,   — wall-clock time in milliseconds
 *     success:    boolean,  — true if exit code was 0
 *     exit_code:  number,   — the actual exit code (0 = success)
 *     timed_out:  boolean,  — true if the client timeout fired
 *   }
 *
 *   `output` is null before the first run, and reset to null at the
 *   start of each new run so OutputPanel shows "running…" instead of
 *   stale results while the new request is in flight.
 *
 * ── Parameters ───────────────────────────────────────────────────────
 *
 *   endpoint       {string}  — POST target (default: '/execute')
 *                              Note: api.js prepends /api, so this is
 *                              the path relative to the /api base.
 *   timeoutMs      {number}  — client-side deadline in milliseconds.
 *                              Default: 35000 (35s) — slightly longer
 *                              than the backend's 30s Pro limit so the
 *                              backend timeout message surfaces first
 *                              under normal conditions.
 *
 * ── Return value ─────────────────────────────────────────────────────
 *
 *   {
 *     output:      object | null  — last execution result
 *     running:     boolean        — true while in flight
 *     outputOpen:  boolean        — OutputPanel expanded state
 *     setOutputOpen: Function     — lets user manually collapse/expand
 *     run:         Function       — run(code, language) → Promise<void>
 *     cancel:      Function       — aborts the in-flight request
 *     clearOutput: Function       — resets output to null
 *   }
 *
 * ── Usage in Editor.jsx ─────────────────────────────────────────────
 *
 *   import { useExecution } from '../hooks/useExecution.js';
 *
 *   const { output, running, outputOpen, setOutputOpen,
 *           run, cancel, clearOutput } = useExecution();
 *
 *   // Replace handleRun with:
 *   function handleRun() {
 *     const code = editorRef.current?.getValue() ?? '';
 *     run(code, doc?.language ?? 'javascript');
 *   }
 *
 *   // Remove from Editor.jsx:
 *   //   const [output,     setOutput]     = useState(null);
 *   //   const [running,    setRunning]    = useState(false);
 *   //   const [outputOpen, setOutputOpen] = useState(true);
 *   //   async function handleRun() { ... }
 *
 *   // Pass to OutputPanel:
 *   <OutputPanel
 *     output={output}
 *     running={running}
 *     open={outputOpen}
 *     onToggle={() => setOutputOpen(o => !o)}
 *     onClear={clearOutput}
 *   />
 *
 *   // Pass running to Navbar (already done via runDisabled/running props):
 *   <Navbar
 *     ...
 *     onRunClick={handleRun}
 *     running={running}
 *   />
 */

import { useState, useRef, useCallback } from 'react';
import api from '../utils/api.js';

/* ─────────────────────────────────────────────────────────────────────
   DEFAULT TIMEOUT
   35 seconds — just beyond the backend's 30s Pro execution limit.
   Free tier limit is 10s, but we use a single generous client timeout
   rather than adjusting per-plan, since the backend will send back a
   meaningful "timed out" message in its stderr before this fires under
   normal conditions. This timeout only catches the case where the
   backend goes completely silent (crash, network partition, cold start).
───────────────────────────────────────────────────────────────────── */
const DEFAULT_TIMEOUT_MS = 35_000;

/* ─────────────────────────────────────────────────────────────────────
   useExecution
───────────────────────────────────────────────────────────────────── */
export function useExecution({
  endpoint  = '/execute',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {

  const [output,      setOutput]      = useState(null);
  const [running,     setRunning]     = useState(false);
  const [outputOpen,  setOutputOpen]  = useState(false);

  /* AbortController for the in-flight request */
  const abortRef   = useRef(null);
  /* setTimeout handle for the client-side deadline */
  const timerRef   = useRef(null);
  /* Wall-clock start time — used to compute elapsed_ms on the client */
  const startRef   = useRef(null);

  /* ── Internal cleanup ──
     Called in the finally block of every run attempt, and also by
     cancel(). Clears the timeout timer and nulls the abort ref so
     neither fires after the request has already finished. */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current = null;
  }, []);

  /* ── cancel ──
     Aborts the in-flight fetch. The finally block in run() handles
     state cleanup — callers don't need to do anything extra. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ── clearOutput ──
     Resets the output panel to its idle state. */
  const clearOutput = useCallback(() => {
    setOutput(null);
  }, []);

  /* ── run ──
     The main action. POSTs `code` + `language` to the execution
     endpoint and stores the result in `output`.

     Parameters:
       code     {string}  — the full source code to execute
       language {string}  — language key: 'javascript' | 'python' | etc.
  */
  const run = useCallback(async (code, language = 'javascript') => {
    /* Guards — don't run if already running or code is empty */
    if (running) return;
    if (!code?.trim()) return;

    /* Reset output and expand the panel before the request fires
       so the user sees "running…" immediately, not stale output */
    setOutput(null);
    setOutputOpen(true);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;
    startRef.current = Date.now();

    /* ── Client-side timeout ──
       If the backend doesn't respond within timeoutMs, abort the
       fetch and synthesise a timeout error in the same output shape
       that OutputPanel expects. */
    timerRef.current = setTimeout(() => {
      controller.abort();
      const elapsed = Date.now() - (startRef.current ?? Date.now());
      setOutput({
        stdout:     '',
        stderr:     `Execution timed out after ${(elapsed / 1000).toFixed(1)}s.\n` +
                    `The server did not respond within the allowed time.\n` +
                    `Try running a shorter snippet or check your internet connection.`,
        elapsed_ms: elapsed,
        success:    false,
        exit_code:  -1,
        timed_out:  true,
      });
      setRunning(false);
      cleanup();
    }, timeoutMs);

    try {
      const { data } = await api.post(endpoint, { code, language }, {
        signal: controller.signal,
      });

      /* Backend returned successfully — store result as-is.
         Fill in any missing fields defensively so OutputPanel never
         needs to null-check individual properties. */
      setOutput({
        stdout:     data.stdout     ?? '',
        stderr:     data.stderr     ?? '',
        elapsed_ms: data.elapsed_ms ?? (Date.now() - startRef.current),
        success:    data.success    ?? (data.exit_code === 0),
        exit_code:  data.exit_code  ?? (data.success ? 0 : 1),
        timed_out:  false,
      });

    } catch (err) {
      /* AbortError from the timeout handler already set output above —
         don't overwrite it with a generic error. For user-initiated
         cancel we also skip — there's nothing meaningful to show. */
      if (err?.name === 'AbortError') return;

      /* Real network or server error */
      const elapsed = Date.now() - (startRef.current ?? Date.now());
      const message =
        err?.response?.data?.error ??
        err?.message ??
        'Execution failed. Please try again.';

      setOutput({
        stdout:     '',
        stderr:     message,
        elapsed_ms: elapsed,
        success:    false,
        exit_code:  1,
        timed_out:  false,
      });

    } finally {
      cleanup();
      setRunning(false);
    }
  }, [running, endpoint, timeoutMs, cleanup]);

  return {
    output,
    running,
    outputOpen,
    setOutputOpen,
    run,
    cancel,
    clearOutput,
  };
}

export default useExecution;
