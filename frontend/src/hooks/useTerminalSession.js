/**
 * hooks/useTerminalSession.js — Phase 7 interactive execution session
 *
 * Owns the `/terminal` Socket.IO connection (services/terminalSocket.js)
 * and the lifecycle of whatever session is currently running on it.
 * Output is delivered via an `onOutput(data)` callback rather than
 * accumulated into React state — a real terminal can emit hundreds of
 * chunks a second, and funneling each one through setState/re-render
 * would make typing and scrolling visibly lag. Terminal.jsx instead
 * writes each chunk straight into its xterm.js instance imperatively.
 *
 * One socket connection lives for as long as this hook is mounted
 * (i.e. for as long as the Editor page's terminal panel exists) and is
 * reused across multiple Run clicks — it is NOT reopened per run.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  connectTerminalSocket,
  startSession,
  sendInput as sendInputEvent,
  resizeSession as resizeSessionEvent,
  stopSession as stopSessionEvent,
  TERMINAL_EVENTS,
} from '../services/terminalSocket.js';
import { EXECUTION_ENABLED } from '../utils/env.js';

export function useTerminalSession({ onOutput } = {}) {
  const socketRef = useRef(null);
  const socketPromiseRef = useRef(null);
  const sessionIdRef = useRef(null);
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;

  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastExit, setLastExit] = useState(null); // { exitCode, reason, truncated } | null
  const [error, setError] = useState(null);

  const ensureSocket = useCallback(async () => {
    if (socketRef.current) return socketRef.current;
    if (socketPromiseRef.current) return socketPromiseRef.current;

    setConnecting(true);
    socketPromiseRef.current = connectTerminalSocket().then((socket) => {
      socketRef.current = socket;

      socket.on(TERMINAL_EVENTS.READY, ({ sessionId }) => {
        sessionIdRef.current = sessionId;
        setRunning(true);
        setError(null);
      });

      socket.on(TERMINAL_EVENTS.OUTPUT, ({ sessionId, data }) => {
        if (sessionId !== sessionIdRef.current) return;
        onOutputRef.current?.(data);
      });

      socket.on(TERMINAL_EVENTS.EXIT, ({ sessionId, exitCode, reason, truncated }) => {
        if (sessionId !== sessionIdRef.current) return;
        setRunning(false);
        setLastExit({ exitCode, reason, truncated });
        sessionIdRef.current = null;
      });

      socket.on(TERMINAL_EVENTS.ERROR, ({ sessionId, message }) => {
        /* A validation error (unsupported language / empty code) comes
           back with sessionId: null before READY ever fired, so
           sessionIdRef.current is also still null here - the equality
           check below intentionally allows that case through. */
        if (sessionId && sessionId !== sessionIdRef.current) return;
        setError(message);
        setRunning(false);
        sessionIdRef.current = null;
      });

      /* Covers the server closing the connection (restart, crash) and
         any transport-level drop. Deliberately not auto-reconnected
         (see terminalSocket.js) - a dropped session is gone, not
         something to transparently resume mid-run. */
      socket.on('disconnect', () => {
        if (sessionIdRef.current) {
          setRunning(false);
          setError('Connection to the execution server was lost.');
          sessionIdRef.current = null;
        }
      });

      socket.on('connect_error', (err) => {
        setError(err.message || 'Failed to connect to the execution server.');
      });

      setConnecting(false);
      return socket;
    });

    return socketPromiseRef.current;
  }, []);

  const run = useCallback(async (language, code, projectId) => {
    /* Demo-mode gate (see utils/env.js) — never open the /terminal
       socket at all in a deployment with execution disabled, so
       there's no websocket round trip (and no websocket error) to
       show the user, just the friendly message set here. */
    if (!EXECUTION_ENABLED) {
      setError('Code execution is unavailable in this public testing deployment.');
      return;
    }
    setError(null);
    setLastExit(null);
    const socket = await ensureSocket();
    startSession(socket, { language, code, projectId });
  }, [ensureSocket]);

  const sendInput = useCallback((data) => {
    if (!socketRef.current || !sessionIdRef.current) return;
    sendInputEvent(socketRef.current, sessionIdRef.current, data);
  }, []);

  const resize = useCallback((cols, rows) => {
    if (!socketRef.current || !sessionIdRef.current) return;
    resizeSessionEvent(socketRef.current, sessionIdRef.current, cols, rows);
  }, []);

  const stop = useCallback(() => {
    if (!socketRef.current || !sessionIdRef.current) return;
    stopSessionEvent(socketRef.current, sessionIdRef.current);
  }, []);

  /* Tear the connection down when the terminal panel unmounts (e.g.
     navigating away from the Editor entirely) - the backend's own
     disconnect handler (terminalSocket.js) stops whatever session was
     still running for this socket, so no container is left behind. */
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      socketPromiseRef.current = null;
    };
  }, []);

  return { running, connecting, lastExit, error, run, sendInput, resize, stop };
}
