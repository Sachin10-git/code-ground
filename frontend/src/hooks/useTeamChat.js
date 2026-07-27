/**
 * hooks/useTeamChat.js — Phase 6.0 Team Chat
 *
 * Discord-style project room chat. Reuses the exact same shared
 * `/workspace` Socket.IO connection useWorkspaceSync and
 * useFilePresence already hold open (see acquireWorkspaceSocket in
 * services/workspaceSocket.js) — Team Chat never opens a socket of its
 * own. It still requests WORKSPACE_JOIN itself rather than assuming
 * some other hook already has (join is idempotent server-side, and the
 * server re-sends chat history on every join anyway), so this hook
 * stays self-contained and doesn't depend on FileExplorer being
 * mounted.
 *
 * A project's chat history is authoritative from the server: every
 * WORKSPACE_JOIN gets a fresh TEAM_CHAT_HISTORY snapshot (initial load,
 * project switch, and reconnect-after-a-drop all funnel through the
 * same join), so this hook always *replaces* its message list on
 * history receipt rather than merging — there's nothing to reconcile.
 * Sent messages have no local optimistic echo either: the server
 * broadcasts the persisted copy back to the sender too, so every
 * client's list is built from that one round trip.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  acquireWorkspaceSocket,
  releaseWorkspaceSocket,
  joinProjectRoom,
  leaveProjectRoom,
  sendChatMessage,
  WORKSPACE_EVENTS,
} from '../services/workspaceSocket.js';

export function useTeamChat({ projectId, currentUserId, isActive }) {
  const socketRef = useRef(null);

  const [messages, setMessages]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [unreadCount, setUnreadCount]   = useState(0);

  /* `isActive` (whether the Team tab is the one currently showing) is
     read inside socket callbacks that only get re-attached when
     `projectId` changes — a ref keeps them seeing the latest value
     without re-subscribing on every tab switch. Becoming active also
     clears any unread count accumulated while it wasn't. */
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive) setUnreadCount(0);
  }, [isActive]);

  const currentUserIdRef = useRef(currentUserId);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  /* Connection lifecycle — acquire the shared socket on mount, release
     on unmount. Identical shape to useWorkspaceSync/useFilePresence. */
  const [socketReadyTick, forceRoomEffect] = useState(0);
  useEffect(() => {
    let cancelled = false;

    acquireWorkspaceSocket().then((socket) => {
      if (cancelled) {
        releaseWorkspaceSocket();
        return;
      }
      socketRef.current = socket;
      forceRoomEffect((n) => n + 1);
    });

    return () => {
      cancelled = true;
      if (socketRef.current) releaseWorkspaceSocket();
      socketRef.current = null;
    };
  }, []);

  /* Project room membership + chat subscriptions — re-run whenever the
     project changes: leaves the previous room, removes its listeners,
     joins the new one and waits for a fresh history snapshot. */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    setLoading(true);
    setMessages([]);

    if (socket.connected) joinProjectRoom(socket, projectId);

    /* Covers both the initial connect and any reconnect after a drop —
       either way the server responds with TEAM_CHAT_HISTORY, so there's
       no separate resync path to write for chat specifically. */
    function handleConnect() {
      joinProjectRoom(socket, projectId);
    }

    function onHistory({ projectId: historyProjectId, messages: history } = {}) {
      if (historyProjectId !== projectId) return;
      setMessages(history ?? []);
      setLoading(false);
    }

    function onMessage(payload) {
      if (!payload || payload.projectId !== projectId) return;
      setMessages((prev) => [...prev, payload]);

      const isOwnMessage = String(payload.userId) === String(currentUserIdRef.current);
      if (!isOwnMessage && !isActiveRef.current) {
        setUnreadCount((n) => n + 1);
      }
    }

    /* Avoids an infinite loading spinner if the socket never manages to
       connect at all (history would otherwise never arrive to clear it). */
    function handleConnectError() {
      setLoading(false);
    }

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on(WORKSPACE_EVENTS.TEAM_CHAT_HISTORY, onHistory);
    socket.on(WORKSPACE_EVENTS.TEAM_CHAT_MESSAGE, onMessage);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off(WORKSPACE_EVENTS.TEAM_CHAT_HISTORY, onHistory);
      socket.off(WORKSPACE_EVENTS.TEAM_CHAT_MESSAGE, onMessage);
      leaveProjectRoom(socket, projectId);
    };
  }, [projectId, socketReadyTick]);

  const sendMessage = useCallback((text) => {
    sendChatMessage(socketRef.current, projectId, text);
  }, [projectId]);

  return { messages, loading, unreadCount, sendMessage };
}

export default useTeamChat;
