/**
 * services/terminalSocket.js — Phase 7 interactive execution transport
 *
 * A thin wrapper around a Socket.IO connection to the `/terminal`
 * namespace — its own namespace (and therefore its own physical
 * connection), the same way `/workspace` is kept separate from the
 * default namespace's Yjs editor collaboration (see
 * services/workspaceSocket.js for that precedent, and
 * backend/src/socket/terminalSocket.js for the server-side rationale).
 *
 * NOTE: callers should check utils/env.js's EXECUTION_ENABLED before
 * ever invoking connectTerminalSocket() — see Terminal.jsx and
 * useTerminalSession.js, which skip opening this connection entirely
 * in demo-mode deployments rather than opening it and immediately
 * getting a terminal:error back.
 *
 * Unlike workspaceSocket.js, this is NOT a ref-counted shared
 * singleton: exactly one component (Terminal.jsx, via
 * useTerminalSession.js) uses this connection, for exactly as long as
 * the Editor page's terminal panel is mounted - so a plain connect-on-
 * mount/disconnect-on-unmount lifecycle is enough, with no reference
 * counting needed.
 */

import { SOCKET_URL } from '../utils/env.js';

export const TERMINAL_EVENTS = {
  START: 'terminal:start',
  READY: 'terminal:ready',
  OUTPUT: 'terminal:output',
  INPUT: 'terminal:input',
  RESIZE: 'terminal:resize',
  STOP: 'terminal:stop',
  EXIT: 'terminal:exit',
  ERROR: 'terminal:error',
};

/**
 * Opens a new connection to the `/terminal` namespace. Dynamic import,
 * same as useYjs.js/workspaceSocket.js — keeps socket.io-client out of
 * the initial bundle and avoids Vite splitting the same dependency into
 * multiple chunks across static/dynamic import sites.
 */
export async function connectTerminalSocket() {
  const { io } = await import('socket.io-client');
  const token = localStorage.getItem('cg_token');
  return io(`${SOCKET_URL}/terminal`, {
    auth: { token },
    transports: ['websocket'],
    /* Deliberately no automatic reconnection: a reconnect would hand
       back a NEW socket.id, and the backend ties every session to the
       exact socket.id that created it (see executionSession.service.js's
       isOwnedBy) — a silently reconnected socket could no longer send
       input to, resize, or stop the session it thinks it still owns.
       useTerminalSession.js treats a drop as "this run's session is
       gone" rather than something to transparently paper over. */
    reconnection: false,
  });
}

export function startSession(socket, { language, code, projectId }) {
  if (!socket) return;
  socket.emit(TERMINAL_EVENTS.START, { language, code, projectId });
}

export function sendInput(socket, sessionId, data) {
  if (!socket || !sessionId) return;
  socket.emit(TERMINAL_EVENTS.INPUT, { sessionId, data });
}

export function resizeSession(socket, sessionId, cols, rows) {
  if (!socket || !sessionId) return;
  socket.emit(TERMINAL_EVENTS.RESIZE, { sessionId, cols, rows });
}

export function stopSession(socket, sessionId) {
  if (!socket || !sessionId) return;
  socket.emit(TERMINAL_EVENTS.STOP, { sessionId });
}
