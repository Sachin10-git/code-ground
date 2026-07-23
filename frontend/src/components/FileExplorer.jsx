/**
 * FileExplorer.jsx — minimal workspace sidebar (Phase 3)
 *
 * Loads the real Project/Folder/File hierarchy from the backend and
 * lets the user browse, create, rename and delete folders/files.
 * Deliberately isolated from Editor.jsx so it can be enhanced later
 * (drag-to-move, icons per language, etc.) without touching the page.
 *
 * Scope for this phase: navigation only. Selecting a file only updates
 * `selectedFileId` via the `onSelectFile` prop — no Monaco binding, no
 * file content loading, no autosave.
 *
 * ── API used (backend/src/routes/{folder,file}.routes.js) ───────────
 *   GET    /projects/:projectId/tree        → { project, folders, files }
 *   POST   /projects/:projectId/folders     { name, parentFolderId }
 *   PATCH  /projects/folders/:folderId      { name }
 *   DELETE /projects/folders/:folderId
 *   POST   /projects/:projectId/files       { name, folderId }
 *   PATCH  /projects/files/:fileId          { name }
 *   DELETE /projects/files/:fileId
 *
 * ── Tree data structure ──────────────────────────────────────────────
 * The backend returns `folders`/`files` as flat arrays (hierarchy
 * expressed via `parentFolderId`/`folderId`). buildTree() normalizes
 * that into { root, foldersById, filesById } ONCE on load; every
 * subsequent create/rename/delete updates only the affected node and
 * its direct parent, so no flat-array re-filtering happens on render
 * or after mutations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api.js';
import styles from './FileExplorer.module.css';

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
   extractApiError — folder/file routes have no express-validator
   layer, so every error (ApiError 403/404, or a raw Mongoose
   ValidationError surfaced as a 500) puts its text in `message`.
   Kept local to this file, mirroring the pattern established for
   Dashboard.jsx in Phase 2 (no shared util module).
───────────────────────────────────────────────────────────────────── */
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
   folder/file names, so Create/Rename must check locally before
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
function FileRow({ file, depth, selectedFileId, renaming, actions }) {
  const isRenaming = renaming?.type === 'file' && renaming.id === file._id;
  const isSelected = selectedFileId === file._id;

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.row_selected : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
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
   from a flat array).
───────────────────────────────────────────────────────────────────── */
function FolderRow({ folderId, depth, tree, collapsedIds, selectedFileId, selectedFolderId, creating, renaming, actions }) {
  const folder = tree.foldersById[folderId];
  if (!folder) return null;

  const collapsed = collapsedIds.has(folderId);
  const isRenaming = renaming?.type === 'folder' && renaming.id === folderId;
  const isSelected = selectedFolderId === folderId;

  return (
    <div>
      <div
        className={`${styles.row} ${isSelected ? styles.row_selected : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
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
              creating={creating} renaming={renaming} actions={actions}
            />
          ))}
          {folder.fileIds.map(fileId => (
            <FileRow
              key={fileId} file={tree.filesById[fileId]} depth={depth + 1}
              selectedFileId={selectedFileId} renaming={renaming} actions={actions}
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
export default function FileExplorer({ projectId, selectedFileId, onSelectFile }) {
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [tree, setTree]                 = useState(null);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [creating, setCreating]         = useState(null); // { parentId, type }
  const [renaming, setRenaming]         = useState(null); // { id, type }
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = root

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

  /* ── Incremental tree mutations — touch only the affected node
     and its direct parent, never the full folder/file arrays. ── */
  const insertFolder = useCallback((folder) => {
    setTree(prev => {
      if (!prev) return prev;
      const foldersById = { ...prev.foldersById, [folder._id]: { ...folder, folderIds: [], fileIds: [] } };
      if (folder.parentFolderId) {
        const parent = prev.foldersById[folder.parentFolderId];
        foldersById[folder.parentFolderId] = { ...parent, folderIds: [...parent.folderIds, folder._id] };
        return { ...prev, foldersById };
      }
      return { ...prev, foldersById, root: { ...prev.root, folderIds: [...prev.root.folderIds, folder._id] } };
    });
  }, []);

  const insertFile = useCallback((file) => {
    setTree(prev => {
      if (!prev) return prev;
      const filesById = { ...prev.filesById, [file._id]: file };
      if (file.folderId) {
        const parent = prev.foldersById[file.folderId];
        const foldersById = { ...prev.foldersById, [file.folderId]: { ...parent, fileIds: [...parent.fileIds, file._id] } };
        return { ...prev, filesById, foldersById };
      }
      return { ...prev, filesById, root: { ...prev.root, fileIds: [...prev.root.fileIds, file._id] } };
    });
  }, []);

  const renameFolderInTree = useCallback((folderId, name) => {
    setTree(prev => {
      if (!prev || !prev.foldersById[folderId]) return prev;
      return { ...prev, foldersById: { ...prev.foldersById, [folderId]: { ...prev.foldersById[folderId], name } } };
    });
  }, []);

  const renameFileInTree = useCallback((fileId, name) => {
    setTree(prev => {
      if (!prev || !prev.filesById[fileId]) return prev;
      return { ...prev, filesById: { ...prev.filesById, [fileId]: { ...prev.filesById[fileId], name } } };
    });
  }, []);

  const removeFolder = useCallback((folder) => {
    setTree(prev => {
      if (!prev) return prev;
      const foldersById = { ...prev.foldersById };
      delete foldersById[folder._id];
      if (folder.parentFolderId) {
        const parent = foldersById[folder.parentFolderId];
        foldersById[folder.parentFolderId] = { ...parent, folderIds: parent.folderIds.filter(id => id !== folder._id) };
        return { ...prev, foldersById };
      }
      return { ...prev, foldersById, root: { ...prev.root, folderIds: prev.root.folderIds.filter(id => id !== folder._id) } };
    });
  }, []);

  const removeFile = useCallback((file) => {
    setTree(prev => {
      if (!prev) return prev;
      const filesById = { ...prev.filesById };
      delete filesById[file._id];
      if (file.folderId) {
        const parent = prev.foldersById[file.folderId];
        const foldersById = { ...prev.foldersById, [file.folderId]: { ...parent, fileIds: parent.fileIds.filter(id => id !== file._id) } };
        return { ...prev, filesById, foldersById };
      }
      return { ...prev, filesById, root: { ...prev.root, fileIds: prev.root.fileIds.filter(id => id !== file._id) } };
    });
  }, []);

  /* ── Backend actions ──
     Each create/rename checks sibling names locally first — the
     backend has no uniqueness validation, so this is the only guard
     against duplicate names. Validation failure resets `creating`/
     `renaming` (same as a rejected API call) so the row doesn't stay
     stuck open with a dead input. ── */
  const onCreateFolder = useCallback(async (parentId, name) => {
    if (tree && folderSiblingNames(tree, parentId).includes(name)) {
      setError('A folder with this name already exists in this location.');
      setCreating(null);
      return;
    }
    try {
      const { data } = await api.post(`/projects/${projectId}/folders`, { name, parentFolderId: parentId });
      insertFolder(data.data);
      setCreating(null);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [projectId, insertFolder, tree]);

  const onCreateFile = useCallback(async (parentId, name) => {
    if (tree && fileSiblingNames(tree, parentId).includes(name)) {
      setError('A file with this name already exists in this folder.');
      setCreating(null);
      return;
    }
    try {
      const { data } = await api.post(`/projects/${projectId}/files`, { name, folderId: parentId });
      insertFile(data.data);
      setCreating(null);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [projectId, insertFile, tree]);

  const onRenameFolder = useCallback(async (folderId, name) => {
    const folder = tree?.foldersById[folderId];
    if (folder && folderSiblingNames(tree, folder.parentFolderId, folderId).includes(name)) {
      setError('A folder with this name already exists in this location.');
      setRenaming(null);
      return;
    }
    try {
      await api.patch(`/projects/folders/${folderId}`, { name });
      renameFolderInTree(folderId, name);
      setRenaming(null);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [renameFolderInTree, tree]);

  const onRenameFile = useCallback(async (fileId, name) => {
    const file = tree?.filesById[fileId];
    if (file && fileSiblingNames(tree, file.folderId, fileId).includes(name)) {
      setError('A file with this name already exists in this folder.');
      setRenaming(null);
      return;
    }
    try {
      await api.patch(`/projects/files/${fileId}`, { name });
      renameFileInTree(fileId, name);
      setRenaming(null);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [renameFileInTree, tree]);

  const onDeleteFolder = useCallback(async (folder) => {
    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
    try {
      await api.delete(`/projects/folders/${folder._id}`);
      removeFolder(folder);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [removeFolder]);

  const onDeleteFile = useCallback(async (file) => {
    if (!window.confirm(`Delete file "${file.name}"?`)) return;
    try {
      await api.delete(`/projects/files/${file._id}`);
      removeFile(file);
    } catch (err) {
      setError(extractApiError(err));
    }
  }, [removeFile]);

  const actions = {
    onSelectFile, toggleCollapsed, expandFolder, selectFolder, setCreating, setRenaming,
    onCreateFolder, onCreateFile, onRenameFolder, onRenameFile,
    onDeleteFolder, onDeleteFile,
  };

  const isEmpty = tree && tree.root.folderIds.length === 0 && tree.root.fileIds.length === 0 && !creating;

  return (
    <div className={styles.root}>
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

          <div className={styles.tree}>
            {tree.root.folderIds.map(id => (
              <FolderRow
                key={id} folderId={id} depth={0} tree={tree}
                collapsedIds={collapsedIds} selectedFileId={selectedFileId}
                selectedFolderId={selectedFolderId}
                creating={creating} renaming={renaming} actions={actions}
              />
            ))}
            {tree.root.fileIds.map(id => (
              <FileRow
                key={id} file={tree.filesById[id]} depth={0}
                selectedFileId={selectedFileId} renaming={renaming} actions={actions}
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
  );
}
