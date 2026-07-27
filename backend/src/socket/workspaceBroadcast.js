const SOCKET_EVENTS = require("./socketConstants");
const { getWorkspaceNamespace } = require("./workspaceSocket");
const workspaceActivityService = require("../services/workspaceActivityService");

/**
 * Phase 6.1 — thin emit helpers for workspace mutations.
 *
 * Each function broadcasts only the minimum fields a client needs to
 * patch its explorer tree — never the full Mongo document — to every
 * socket that has joined the project's room on the `/workspace`
 * namespace. Called from the file/folder controllers, always AFTER
 * the triggering mutation has been persisted successfully.
 *
 * Phase 6.3: every payload also carries `username` (the acting user,
 * passed down from the controller's `req.user`) and, for delete/move,
 * the target's `name` — neither was needed for tree sync alone, but
 * the client-side activity feed (useWorkspaceSync.js) attributes each
 * entry from these same events and has no other source for either
 * field.
 *
 * Enhancement 1: rename payloads additionally carry `oldName`/
 * `newName` (`name` is left in place, still equal to the new name, so
 * the existing tree-sync consumers of `payload.name` are untouched).
 *
 * Enhancement 2 (Phase 6.4): each function now also persists a
 * WorkspaceActivity record via workspaceActivityService — same call
 * site, same data as the broadcast, so the live feed and the
 * persisted history can never drift apart. Persistence failures are
 * logged and swallowed here rather than thrown, so a Mongo hiccup
 * can never turn an otherwise-successful file/folder operation into a
 * 500 for the user or block the real-time broadcast peers depend on.
 */

const emit = (projectId, event, payload) => {
  getWorkspaceNamespace().to(String(projectId)).emit(event, payload);
};

const persistActivity = async (fields) => {
  try {
    await workspaceActivityService.recordActivity(fields);
  } catch (err) {
    console.error("[WorkspaceActivity] Failed to persist activity:", err);
  }
};

const broadcastFileCreated = async (projectId, file, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_CREATED, {
    _id:      file._id,
    name:     file.name,
    folderId: file.folderId ?? null,
    language: file.language,
    username,
  });
  await persistActivity({
    projectId, username, operation: "created", targetType: "file", targetName: file.name,
  });
};

const broadcastFileRenamed = async (projectId, file, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_RENAMED, {
    _id:     file._id,
    name:    file.name,
    oldName: file.oldName,
    newName: file.name,
    username,
  });
  await persistActivity({
    projectId, username, operation: "renamed", targetType: "file", targetName: file.name,
    oldName: file.oldName, newName: file.name,
  });
};

const broadcastFileDeleted = async (projectId, file, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_DELETED, {
    _id:  file._id,
    name: file.name,
    username,
  });
  await persistActivity({
    projectId, username, operation: "deleted", targetType: "file", targetName: file.name,
  });
};

const broadcastFileMoved = async (projectId, file, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_MOVED, {
    _id:      file._id,
    name:     file.name,
    folderId: file.folderId ?? null,
    username,
  });
  await persistActivity({
    projectId, username, operation: "moved", targetType: "file", targetName: file.name,
  });
};

const broadcastFolderCreated = async (projectId, folder, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FOLDER_CREATED, {
    _id:            folder._id,
    name:           folder.name,
    parentFolderId: folder.parentFolderId ?? null,
    username,
  });
  await persistActivity({
    projectId, username, operation: "created", targetType: "folder", targetName: folder.name,
  });
};

const broadcastFolderRenamed = async (projectId, folder, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FOLDER_RENAMED, {
    _id:     folder._id,
    name:    folder.name,
    oldName: folder.oldName,
    newName: folder.name,
    username,
  });
  await persistActivity({
    projectId, username, operation: "renamed", targetType: "folder", targetName: folder.name,
    oldName: folder.oldName, newName: folder.name,
  });
};

const broadcastFolderDeleted = async (projectId, folder, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FOLDER_DELETED, {
    _id:  folder._id,
    name: folder.name,
    username,
  });
  await persistActivity({
    projectId, username, operation: "deleted", targetType: "folder", targetName: folder.name,
  });
};

const broadcastFolderMoved = async (projectId, folder, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FOLDER_MOVED, {
    _id:            folder._id,
    name:           folder.name,
    parentFolderId: folder.parentFolderId ?? null,
    username,
  });
  await persistActivity({
    projectId, username, operation: "moved", targetType: "folder", targetName: folder.name,
  });
};

/**
 * Phase 6.6 — file locking's project-wide echo. Called from
 * socketEvents.js's FILE_LOCK/FILE_UNLOCK handlers (and its
 * disconnect/room-leave cleanup) right after fileLockManager.js
 * actually changes lock state, mirroring the exact same emit +
 * persistActivity pattern every other mutation above already uses —
 * so a lock/unlock shows up in the Explorer (lock icon, via the
 * WORKSPACE_FILE_LOCKED/UNLOCKED broadcast) and in the activity feed
 * (via persistActivity) without a second notification system.
 */
const broadcastFileLocked = async (projectId, fileId, fileName, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_LOCKED, {
    fileId,
    name: fileName,
    username,
  });
  await persistActivity({
    projectId, username, operation: "locked", targetType: "file", targetName: fileName,
  });
};

const broadcastFileUnlocked = async (projectId, fileId, fileName, username) => {
  emit(projectId, SOCKET_EVENTS.WORKSPACE_FILE_UNLOCKED, {
    fileId,
    name: fileName,
    username,
  });
  await persistActivity({
    projectId, username, operation: "unlocked", targetType: "file", targetName: fileName,
  });
};

module.exports = {
  broadcastFileCreated,
  broadcastFileRenamed,
  broadcastFileDeleted,
  broadcastFileMoved,
  broadcastFolderCreated,
  broadcastFolderRenamed,
  broadcastFolderDeleted,
  broadcastFolderMoved,
  broadcastFileLocked,
  broadcastFileUnlocked,
};
