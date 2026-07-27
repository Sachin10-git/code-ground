/**
 * FileExplorer.jsx — workspace sidebar (Phase 3, live-synced in Phase 6.1)
 *
 * Loads the real Project/Folder/File hierarchy from the backend and
 * lets the user browse, create, rename, delete and drag-and-drop move
 * folders/files. Deliberately isolated from Editor.jsx — it owns its
 * own tree state and workspace socket connection; Editor.jsx only
 * learns about changes to whichever file it currently has open via
 * the onRemoteFile*  props below.
 *
 * ── API used (backend/src/routes/{folder,file}.routes.js) ───────────
 *   GET    /projects/:projectId/tree        → { project, folders, files }
 *   POST   /projects/:projectId/folders     { name, parentFolderId }
 *   PATCH  /projects/folders/:folderId      { name }
 *   PATCH  /projects/folders/:folderId/move { parentFolderId }
 *   DELETE /projects/folders/:folderId
 *   POST   /projects/:projectId/files       { name, folderId }
 *   PATCH  /projects/files/:fileId          { name }
 *   PATCH  /projects/files/:fileId/move     { folderId }
 *   DELETE /projects/files/:fileId
 *
 * ── Tree data structure ──────────────────────────────────────────────
 * The backend returns `folders`/`files` as flat arrays (hierarchy
 * expressed via `parentFolderId`/`folderId`). buildTree() normalizes
 * that into { root, foldersById, filesById } ONCE on load; every
 * subsequent create/rename/delete/move — whether triggered locally or
 * by a collaborator over the workspace socket — patches only the
 * affected node and its parent(s) via utils/workspaceTreeUtils.js, so
 * no flat-array re-filtering happens on render or after mutations.
 *
 * ── Live sync (Phase 6.1) ─────────────────────────────────────────────
 * useWorkspaceSync (hooks/useWorkspaceSync.js) owns a Socket.IO
 * connection to the `/workspace` namespace, joins this project's room,
 * and calls back into the same tree-util functions the local
 * create/rename/delete/move handlers already use — those functions are
 * idempotent, so the acting user's own broadcast echoing back to them
 * is always a safe no-op.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api.js';
import styles from './FileExplorer.module.css';
import { useWorkspaceSync } from '../hooks/useWorkspaceSync.js';
import ActivityFeed from './ActivityFeed.jsx';
import {
  insertFolder, insertFile,
  renameFolderInTree, renameFileInTree,
  removeFolder, removeFile,
  moveFileInTree, moveFolderInTree,
  isFolderOrDescendant,
} from '../utils/workspaceTreeUtils.js';

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, same style as Editor.jsx/Login.jsx
───────────────────────────────────────────────────────────────────── */
const ChevronRightIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const ChevronDownIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const FolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);
const FileIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const PlusIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);
const Spinner = () => (
  <svg className={styles.spinner ?? ''} width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   FilePresenceBadge — Phase 6.4. Files only (never rendered for
   folders — see FolderRow below). `presence` is this one file's slice
   of useFilePresence's map: `{ [socketId]: { username, state } }`,
   already excluding the current user (the backend never echoes a
   sender's own announcement back to them).
───────────────────────────────────────────────────────────────────── */
function FilePresenceBadge({ presence }) {
  if (!presence) return null;
  const entries = Object.values(presence).filter(e => e?.username);
  if (entries.length === 0) return null;

  if (entries.length === 1) {
    const { username, state } = entries[0];
    return (
      <span
        className={styles.presence_badge}
        title={`${username} is ${state === 'editing' ? 'editing' : 'viewing'} this file`}
      >
        {state === 'editing' ? '✏️' : '👁️'} {username}
      </span>
    );
  }

  const title = entries
    .map(e => `${e.username} (${e.state === 'editing' ? 'editing' : 'viewing'})`)
    .join(', ');
  return (
    <span className={styles.presence_badge} title={title}>
      👥 {entries.length}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FileLockBadge — Phase 6.6. `lock` is this one file's slice of
   useWorkspaceSync's fileLocks map: { username, userId } | undefined.
   Files only (a folder has no content to lock).
───────────────────────────────────────────────────────────────────── */
function FileLockBadge({ lock }) {
  if (!lock?.username) return null;
  return (
    <span className={styles.lock_badge} title={`Locked by ${lock.username}`}>
      <LockIcon />
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   extractApiError — folder/file routes have no express-validator
   layer, so every error (ApiError 403/404, or a raw Mongoose
   ValidationError surfaced as a 500) puts its text in `message`.
   Kept local to this file, mirroring the pattern established for
   Dashboard.jsx in Phase 2 (no shared util module).
───────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   formatActivityMessage — turns the live `{ [socketId]: username }`
   presence map into the banner text ("X is modifying the project...",
   "X and Y are...", "X, Y, and Z are..."). Pure/local, same treatment
   extractApiError gets below — no shared util module for a one-off
   formatter used by a single component.
───────────────────────────────────────────────────────────────────── */
function formatActivityMessage(activeUsers) {
  const names = Object.values(activeUsers);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is modifying the project...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are modifying the project...`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} are modifying the project...`;
}

function extractApiError(err) {
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    'Something went wrong. Please try again.'
  );
}

/* ─────────────────────────────────────────────────────────────────────
   buildTree — normalizes the backend's flat folders/files arrays into
   a lookup structure, built once per load. Two passes: folders first
   (so every folder node exists before any child id is pushed into it),
   then files.
───────────────────────────────────────────────────────────────────── */
function buildTree(folders, files) {
  const foldersById = {};
  const filesById = {};
  const root = { folderIds: [], fileIds: [] };

  folders.forEach(f => {
    foldersById[f._id] = { ...f, folderIds: [], fileIds: [] };
  });
  folders.forEach(f => {
    const bucket = f.parentFolderId ? foldersById[f.parentFolderId] : root;
    if (bucket) bucket.folderIds.push(f._id);
  });
  files.forEach(file => {
    filesById[file._id] = file;
    const bucket = file.folderId ? foldersById[file.folderId] : root;
    if (bucket) bucket.fileIds.push(file._id);
  });

  return { root, foldersById, filesById };
}

/* ─────────────────────────────────────────────────────────────────────
   Sibling name lookups — the backend has no uniqueness validation for
   folder/file names, so Create/Rename/Move must check locally before
   sending the request. "Siblings" means same parent, same type only
   (a file and a folder may share a name; the check never crosses
   folders/files namespaces).
───────────────────────────────────────────────────────────────────── */
function folderSiblingNames(tree, parentFolderId, excludeFolderId) {
  const bucket = parentFolderId ? tree.foldersById[parentFolderId] : tree.root;
  if (!bucket) return [];
  return bucket.folderIds
    .filter(id => id !== excludeFolderId)
    .map(id => tree.foldersById[id].name);
}

function fileSiblingNames(tree, folderId, excludeFileId) {
  const bucket = folderId ? tree.foldersById[folderId] : tree.root;
  if (!bucket) return [];
  return bucket.fileIds
    .filter(id => id !== excludeFileId)
    .map(id => tree.filesById[id].name);
}

/* ─────────────────────────────────────────────────────────────────────
   InlineInput — a bare text input used for both "create" and "rename".
   Enter/blur commits, Escape cancels. Guards against a double-commit
   when Enter fires commit() and the input then also blurs.
───────────────────────────────────────────────────────────────────── */
function InlineInput({ initialValue, onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const doneRef = React.useRef(false);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  return (
    <input
      className={styles.inline_input}
      value={value}
      autoFocus
      onChange={e => setValue(e.target.value)}
      onClick={e => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FileRow
───────────────────────────────────────────────────────────────────── */
function FileRow({ file, depth, selectedFileId, renaming, dragOverId, filePresence, fileLocks, actions }) {
  const isRenaming = renaming?.type === 'file' && renaming.id === file._id;
  const isSelected = selectedFileId === file._id;
  const isDragging = dragOverId?.draggingId === file._id;

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.row_selected : ''} ${isDragging ? styles.row_dragging : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable={!isRenaming}
      onDragStart={e => actions.onDragStart(e, 'file', file._id)}
      onDragEnd={actions.onDragEnd}
      onClick={() => !isRenaming && actions.onSelectFile(file)}
    >
      <span className={styles.row_chevron} aria-hidden="true" />
      <span className={styles.row_icon}><FileIcon /></span>

      {isRenaming ? (
        <InlineInput
          initialValue={file.name}
          onSubmit={name => actions.onRenameFile(file._id, name)}
          onCancel={() => actions.setRenaming(null)}
        />
      ) : (
        <span className={styles.row_name}>{file.name}</span>
      )}

      {!isRenaming && <FilePresenceBadge presence={filePresence?.[file._id]} />}
      {!isRenaming && <FileLockBadge lock={fileLocks?.[file._id]} />}

      {!isRenaming && (
        <span className={styles.row_actions} onClick={e => e.stopPropagation()}>
          <button className={styles.icon_btn} title="Rename file"
            onClick={() => actions.setRenaming({ id: file._id, type: 'file' })}>
            <PencilIcon />
          </button>
          <button className={styles.icon_btn} title="Delete file"
            onClick={() => actions.onDeleteFile(file)}>
            <TrashIcon />
          </button>
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FolderRow — renders itself, then recurses into its own child
   folders/files (looked up directly off its own node, not filtered
   from a flat array). Also a drag-and-drop target: dropping a file or
   folder here moves it into this folder.
───────────────────────────────────────────────────────────────────── */
function FolderRow({ folderId, depth, tree, collapsedIds, selectedFileId, selectedFolderId, creating, renaming, dragOverId, filePresence, fileLocks, actions }) {
  const folder = tree.foldersById[folderId];
  if (!folder) return null;

  const collapsed = collapsedIds.has(folderId);
  const isRenaming = renaming?.type === 'folder' && renaming.id === folderId;
  const isSelected = selectedFolderId === folderId;
  const isDragging = dragOverId?.draggingId === folderId;
  const isDropTarget = dragOverId?.overId === folderId;

  return (
    <div>
      <div
        className={`${styles.row} ${isSelected ? styles.row_selected : ''} ${isDragging ? styles.row_dragging : ''} ${isDropTarget ? styles.row_drop_target : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!isRenaming}
        onDragStart={e => actions.onDragStart(e, 'folder', folderId)}
        onDragEnd={actions.onDragEnd}
        onDragOver={e => actions.onDragOverFolder(e, folderId)}
        onDragLeave={() => actions.onDragLeaveFolder(folderId)}
        onDrop={e => actions.onDropOnFolder(e, folderId)}
        onClick={() => {
          if (isRenaming) return;
          actions.selectFolder(folderId);
          actions.expandFolder(folderId);
        }}
      >
        <span
          className={styles.row_chevron}
          aria-hidden="true"
          onClick={e => { e.stopPropagation(); if (!isRenaming) actions.toggleCollapsed(folderId); }}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </span>
        <span className={styles.row_icon}><FolderIcon /></span>

        {isRenaming ? (
          <InlineInput
            initialValue={folder.name}
            onSubmit={name => actions.onRenameFolder(folderId, name)}
            onCancel={() => actions.setRenaming(null)}
          />
        ) : (
          <span className={styles.row_name}>{folder.name}</span>
        )}

        {!isRenaming && (
          <span className={styles.row_actions} onClick={e => e.stopPropagation()}>
            <button className={styles.icon_btn} title="New file"
              onClick={() => actions.setCreating({ parentId: folderId, type: 'file' })}>
              <PlusIcon />
            </button>
            <button className={styles.icon_btn} title="Rename folder"
              onClick={() => actions.setRenaming({ id: folderId, type: 'folder' })}>
              <PencilIcon />
            </button>
            <button className={styles.icon_btn} title="Delete folder"
              onClick={() => actions.onDeleteFolder(folder)}>
              <TrashIcon />
            </button>
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          {folder.folderIds.map(childId => (
            <FolderRow
              key={childId} folderId={childId} depth={depth + 1} tree={tree}
              collapsedIds={collapsedIds} selectedFileId={selectedFileId}
              selectedFolderId={selectedFolderId}
              creating={creating} renaming={renaming} dragOverId={dragOverId}
              filePresence={filePresence} fileLocks={fileLocks} actions={actions}
            />
          ))}
          {folder.fileIds.map(fileId => (
            <FileRow
              key={fileId} file={tree.filesById[fileId]} depth={depth + 1}
              selectedFileId={selectedFileId} renaming={renaming} dragOverId={dragOverId}
              filePresence={filePresence} fileLocks={fileLocks} actions={actions}
            />
          ))}
          {creating?.parentId === folderId && (
            <div className={styles.row} style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              <span className={styles.row_chevron} aria-hidden="true" />
              <span className={styles.row_icon}>
                {creating.type === 'folder' ? <FolderIcon /> : <FileIcon />}
              </span>
              <InlineInput
                initialValue=""
                onSubmit={name => {
                  creating.type === 'folder'
                    ? actions.onCreateFolder(folderId, name)
                    : actions.onCreateFile(folderId, name);
                }}
                onCancel={() => actions.setCreating(null)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FileExplorer — root component
───────────────────────────────────────────────────────────────────── */
export default function FileExplorer({
  projectId, selectedFileId, onSelectFile,
  onRemoteFileRenamed, onRemoteFileMoved, onRemoteFileDeleted,
  filePresence,
}) {
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [tree, setTree]                 = useState(null);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [creating, setCreating]         = useState(null); // { parentId, type }
  const [renaming, setRenaming]         = useState(null); // { id, type }
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = root
  const [dragOverId, setDragOverId]     = useState(null); // { draggingId, draggingType, overId } | null

  /* Source of truth for the item being dragged — dataTransfer.getData
     isn't reliably readable during dragover in every browser, and
     everything here happens within the same document anyway. */
  const draggingRef = useRef(null); // { type, id } | null

  /* Phase 6.2 — `reportActivity` itself comes from useWorkspaceSync(),
     called further down (after it needs several of the callbacks
     defined below); a ref lets the mutation handlers above that call
     reach it without a circular declaration order. Assigning `.current`
     directly (no effect) is safe here — it's a plain ref write, not
     state, so it can't affect this render's own output. */
  const reportActivityRef = useRef(() => {});

  /* tree is read from within stable callbacks (drag handlers, remote
     event handlers) that must always see the latest tree without
     being re-created every render — mirrors selectedFileRef in
     Editor.jsx. */
  const treeRef = useRef(tree);
  useEffect(() => { treeRef.current = tree; }, [tree]);

  const loadTree = useCallback((cancelledRef) => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    api.get(`/projects/${projectId}/tree`)
      .then(({ data }) => {
        if (cancelledRef?.current) return;
        const { folders = [], files = [] } = data.data ?? {};
        setTree(buildTree(folders, files));
      })
      .catch(err => { if (!cancelledRef?.current) setError(extractApiError(err)); })
      .finally(() => { if (!cancelledRef?.current) setLoading(false); });
  }, [projectId]);

  useEffect(() => {
    const cancelledRef = { current: false };
    loadTree(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [loadTree]);

  const toggleCollapsed = useCallback((id) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const expandFolder = useCallback((id) => {
    setCollapsedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const selectFolder = useCallback((id) => {
    setSelectedFolderId(id);
  }, []);

  /* ── Backend actions ──
     Each create/rename/move checks sibling names locally first — the
     backend has no uniqueness validation, so this is the only guard
     against duplicate names. Validation failure resets `creating`/
     `renaming` (same as a rejected API call) so the row doesn't stay
     stuck open with a dead input. ── */
  const onCreateFolder = useCallback(async (parentId, name) => {
    const currentTree = treeRef.current;
    if (currentTree && folderSiblingNames(currentTree, parentId).includes(name)) {
      setError('A folder with this name already exists in this location.');
      setCreating(null);
      return;
    }
    try {
      const { data } = await api.post(`/projects/${projectId}/folders`, { name, parentFolderId: parentId });
      setTree(prev => insertFolder(prev, data.data));
      setCreating(null);
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [projectId]);

  const onCreateFile = useCallback(async (parentId, name) => {
    const currentTree = treeRef.current;
    if (currentTree && fileSiblingNames(currentTree, parentId).includes(name)) {
      setError('A file with this name already exists in this folder.');
      setCreating(null);
      return;
    }
    try {
      const { data } = await api.post(`/projects/${projectId}/files`, { name, folderId: parentId });
      setTree(prev => insertFile(prev, data.data));
      setCreating(null);
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [projectId]);

  const onRenameFolder = useCallback(async (folderId, name) => {
    const currentTree = treeRef.current;
    const folder = currentTree?.foldersById[folderId];
    if (folder && folderSiblingNames(currentTree, folder.parentFolderId, folderId).includes(name)) {
      setError('A folder with this name already exists in this location.');
      setRenaming(null);
      return;
    }
    try {
      await api.patch(`/projects/folders/${folderId}`, { name });
      setTree(prev => renameFolderInTree(prev, folderId, name));
      setRenaming(null);
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  const onRenameFile = useCallback(async (fileId, name) => {
    const currentTree = treeRef.current;
    const file = currentTree?.filesById[fileId];
    if (file && fileSiblingNames(currentTree, file.folderId, fileId).includes(name)) {
      setError('A file with this name already exists in this folder.');
      setRenaming(null);
      return;
    }
    try {
      await api.patch(`/projects/files/${fileId}`, { name });
      setTree(prev => renameFileInTree(prev, fileId, name));
      setRenaming(null);
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  const onDeleteFolder = useCallback(async (folder) => {
    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
    try {
      await api.delete(`/projects/folders/${folder._id}`);
      setTree(prev => removeFolder(prev, folder));
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  const onDeleteFile = useCallback(async (file) => {
    if (!window.confirm(`Delete file "${file.name}"?`)) return;
    try {
      await api.delete(`/projects/files/${file._id}`);
      setTree(prev => removeFile(prev, file));
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  const onMoveFile = useCallback(async (file, targetFolderId) => {
    const currentFolderId = file.folderId ?? null;
    if (currentFolderId === targetFolderId) return;
    const currentTree = treeRef.current;
    if (currentTree && fileSiblingNames(currentTree, targetFolderId, file._id).includes(file.name)) {
      setError('A file with this name already exists in the destination folder.');
      return;
    }
    try {
      const { data } = await api.patch(`/projects/files/${file._id}/move`, { folderId: targetFolderId });
      setTree(prev => moveFileInTree(prev, data.data));
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  const onMoveFolder = useCallback(async (folder, targetParentId) => {
    const currentParentId = folder.parentFolderId ?? null;
    if (currentParentId === targetParentId || folder._id === targetParentId) return;
    const currentTree = treeRef.current;
    if (currentTree && isFolderOrDescendant(currentTree, folder._id, targetParentId)) {
      setError('A folder cannot be moved into itself or one of its own subfolders.');
      return;
    }
    if (currentTree && folderSiblingNames(currentTree, targetParentId, folder._id).includes(folder.name)) {
      setError('A folder with this name already exists in the destination.');
      return;
    }
    try {
      const { data } = await api.patch(`/projects/folders/${folder._id}/move`, { parentFolderId: targetParentId });
      setTree(prev => moveFolderInTree(prev, data.data));
      reportActivityRef.current();
    } catch (err) {
      setError(extractApiError(err));
    }
  }, []);

  /* ── Drag-and-drop ──
     draggingRef is the source of truth (dataTransfer.getData isn't
     reliably readable outside dragstart/drop in every browser); the
     dataTransfer calls below exist only because some browsers
     (Firefox) refuse to start a drag at all without them. ── */
  const isValidDropTarget = useCallback((dragging, targetFolderId) => {
    if (!dragging) return false;
    const currentTree = treeRef.current;
    if (dragging.type === 'folder') {
      if (dragging.id === targetFolderId) return false;
      if (isFolderOrDescendant(currentTree, dragging.id, targetFolderId)) return false;
      const folder = currentTree?.foldersById[dragging.id];
      if (folder && (folder.parentFolderId ?? null) === targetFolderId) return false;
    } else {
      const file = currentTree?.filesById[dragging.id];
      if (file && (file.folderId ?? null) === targetFolderId) return false;
    }
    return true;
  }, []);

  const onDragStart = useCallback((e, type, id) => {
    draggingRef.current = { type, id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragOverId({ draggingId: id, draggingType: type, overId: null });
  }, []);

  const onDragEnd = useCallback(() => {
    draggingRef.current = null;
    setDragOverId(null);
  }, []);

  const onDragOverFolder = useCallback((e, folderId) => {
    e.stopPropagation();
    const dragging = draggingRef.current;
    if (!isValidDropTarget(dragging, folderId)) return;
    e.preventDefault();
    setDragOverId(prev => (prev && prev.overId === folderId ? prev : { ...prev, draggingId: dragging.id, draggingType: dragging.type, overId: folderId }));
  }, [isValidDropTarget]);

  const onDragLeaveFolder = useCallback((folderId) => {
    setDragOverId(prev => (prev && prev.overId === folderId ? { ...prev, overId: null } : prev));
  }, []);

  const onDropOnFolder = useCallback((e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    const dragging = draggingRef.current;
    draggingRef.current = null;
    setDragOverId(null);
    if (!dragging || !isValidDropTarget(dragging, folderId)) return;

    const currentTree = treeRef.current;
    if (dragging.type === 'file') {
      const file = currentTree?.filesById[dragging.id];
      if (file) onMoveFile(file, folderId);
    } else {
      const folder = currentTree?.foldersById[dragging.id];
      if (folder) onMoveFolder(folder, folderId);
    }
  }, [isValidDropTarget, onMoveFile, onMoveFolder]);

  const onDragOverRoot = useCallback((e) => {
    const dragging = draggingRef.current;
    if (!isValidDropTarget(dragging, null)) return;
    e.preventDefault();
    setDragOverId(prev => (prev && prev.overId === 'root' ? prev : { ...prev, draggingId: dragging.id, draggingType: dragging.type, overId: 'root' }));
  }, [isValidDropTarget]);

  const onDragLeaveRoot = useCallback(() => {
    setDragOverId(prev => (prev && prev.overId === 'root' ? { ...prev, overId: null } : prev));
  }, []);

  const onDropOnRoot = useCallback((e) => {
    e.preventDefault();
    const dragging = draggingRef.current;
    draggingRef.current = null;
    setDragOverId(null);
    if (!dragging || !isValidDropTarget(dragging, null)) return;

    const currentTree = treeRef.current;
    if (dragging.type === 'file') {
      const file = currentTree?.filesById[dragging.id];
      if (file) onMoveFile(file, null);
    } else {
      const folder = currentTree?.foldersById[dragging.id];
      if (folder) onMoveFolder(folder, null);
    }
  }, [isValidDropTarget, onMoveFile, onMoveFolder]);

  /* ── Live workspace sync (Phase 6.1) ──
     Every callback re-applies the same idempotent tree-util function
     the local optimistic path already uses, so a remote event and the
     acting user's own broadcast echo are handled identically. File
     events also notify Editor.jsx in case they affect the file it
     currently has open. ── */
  const onFileDeleted = useCallback((payload) => {
    setTree(prev => {
      const file = prev?.filesById[payload._id];
      return file ? removeFile(prev, file) : prev;
    });
    onRemoteFileDeleted?.(payload._id);
  }, [onRemoteFileDeleted]);

  const onFileRenamed = useCallback((payload) => {
    setTree(prev => renameFileInTree(prev, payload._id, payload.name));
    onRemoteFileRenamed?.(payload._id, payload.name);
  }, [onRemoteFileRenamed]);

  const onFileMoved = useCallback((payload) => {
    setTree(prev => moveFileInTree(prev, payload));
    onRemoteFileMoved?.(payload._id, payload.folderId ?? null);
  }, [onRemoteFileMoved]);

  const onFolderDeleted = useCallback((payload) => {
    setTree(prev => {
      const folder = prev?.foldersById[payload._id];
      return folder ? removeFolder(prev, folder) : prev;
    });
  }, []);

  const { activeUsers, reportActivity, activity, fileLocks } = useWorkspaceSync({
    projectId,
    onResync: () => loadTree(),
    onFileCreated:   useCallback((file)   => setTree(prev => insertFile(prev, file)), []),
    onFileRenamed,
    onFileDeleted,
    onFileMoved,
    onFolderCreated: useCallback((folder) => setTree(prev => insertFolder(prev, folder)), []),
    onFolderRenamed: useCallback((payload) => setTree(prev => renameFolderInTree(prev, payload._id, payload.name)), []),
    onFolderDeleted,
    onFolderMoved:   useCallback((payload) => setTree(prev => moveFolderInTree(prev, payload)), []),
  });

  useEffect(() => {
    reportActivityRef.current = reportActivity;
  }, [reportActivity]);

  const activityMessage = formatActivityMessage(activeUsers);

  const actions = {
    onSelectFile, toggleCollapsed, expandFolder, selectFolder, setCreating, setRenaming,
    onCreateFolder, onCreateFile, onRenameFolder, onRenameFile,
    onDeleteFolder, onDeleteFile,
    onDragStart, onDragEnd, onDragOverFolder, onDragLeaveFolder, onDropOnFolder,
  };

  const isEmpty = tree && tree.root.folderIds.length === 0 && tree.root.fileIds.length === 0 && !creating;
  const rootIsDropTarget = dragOverId?.overId === 'root';

  return (
    <div className={styles.root}>
      {activityMessage && (
        <div className={styles.activity_banner} role="status">
          {activityMessage}
        </div>
      )}

      <div className={styles.header}>
        <span
          className={styles.header_title}
          title="Deselect folder (new items go to root)"
          onClick={() => setSelectedFolderId(null)}
        >
          Explorer
        </span>
        <span className={styles.header_actions}>
          <button className={styles.icon_btn}
            title={selectedFolderId ? 'New file in selected folder' : 'New root file'}
            onClick={() => setCreating({ parentId: selectedFolderId, type: 'file' })}>
            <PlusIcon />
          </button>
          <button className={styles.icon_btn}
            title={selectedFolderId ? 'New folder in selected folder' : 'New root folder'}
            onClick={() => setCreating({ parentId: selectedFolderId, type: 'folder' })}>
            <FolderIcon />
          </button>
        </span>
      </div>

      <div className={styles.explorer_body}>
      {loading && (
        <div className={styles.state_msg}><Spinner /> Loading files…</div>
      )}

      {!loading && error && !tree && (
        <div className={styles.state_msg}>
          <div className={styles.error_banner}>{error}</div>
          <button className={styles.icon_btn} onClick={loadTree}>Retry</button>
        </div>
      )}

      {!loading && tree && (
        <>
          {error && <div className={styles.error_banner}>{error}</div>}

          <div
            className={`${styles.tree} ${rootIsDropTarget ? styles.tree_drop_target : ''}`}
            onDragOver={onDragOverRoot}
            onDragLeave={onDragLeaveRoot}
            onDrop={onDropOnRoot}
          >
            {tree.root.folderIds.map(id => (
              <FolderRow
                key={id} folderId={id} depth={0} tree={tree}
                collapsedIds={collapsedIds} selectedFileId={selectedFileId}
                selectedFolderId={selectedFolderId}
                creating={creating} renaming={renaming} dragOverId={dragOverId}
                filePresence={filePresence} fileLocks={fileLocks} actions={actions}
              />
            ))}
            {tree.root.fileIds.map(id => (
              <FileRow
                key={id} file={tree.filesById[id]} depth={0}
                selectedFileId={selectedFileId} renaming={renaming} dragOverId={dragOverId}
                filePresence={filePresence} fileLocks={fileLocks} actions={actions}
              />
            ))}

            {creating?.parentId === null && (
              <div className={styles.row} style={{ paddingLeft: 8 }}>
                <span className={styles.row_chevron} aria-hidden="true" />
                <span className={styles.row_icon}>
                  {creating.type === 'folder' ? <FolderIcon /> : <FileIcon />}
                </span>
                <InlineInput
                  initialValue=""
                  onSubmit={name => {
                    creating.type === 'folder' ? onCreateFolder(null, name) : onCreateFile(null, name);
                  }}
                  onCancel={() => setCreating(null)}
                />
              </div>
            )}

            {isEmpty && <div className={styles.state_msg}>No files yet.</div>}
          </div>
        </>
      )}
      </div>

      <ActivityFeed activity={activity} />
    </div>
  );
}
