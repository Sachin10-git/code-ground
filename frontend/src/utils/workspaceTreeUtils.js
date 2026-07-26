/**
 * utils/workspaceTreeUtils.js — Phase 6.1
 *
 * Pure functions that patch a FileExplorer `{ root, foldersById,
 * filesById }` tree (see FileExplorer.jsx's buildTree) one node at a
 * time. Originally local to FileExplorer.jsx (Phase 3); extracted
 * here so the exact same functions drive both the local/optimistic
 * path (after a REST call the acting user made resolves) and the
 * remote path (a workspace:* socket event from another collaborator).
 *
 * Every function is idempotent: applying the same mutation twice (or
 * applying a remote event for something the local REST response
 * already applied) is a safe no-op rather than a duplicate node or a
 * crash. That's what lets the acting user's own broadcast echo back
 * to them through the same project room without special-casing "is
 * this my own event" anywhere.
 */

export function insertFolder(tree, folder) {
  if (!tree || tree.foldersById[folder._id]) return tree;

  /* A brand-new folder (create) has no children yet, so folderIds/
     fileIds default to []. moveFolderInTree below reuses this same
     function to re-insert a folder that already has a populated
     subtree — `??` preserves those arrays instead of wiping them. */
  const foldersById = {
    ...tree.foldersById,
    [folder._id]: { ...folder, folderIds: folder.folderIds ?? [], fileIds: folder.fileIds ?? [] },
  };
  const parentId = folder.parentFolderId ?? null;

  if (parentId) {
    const parent = foldersById[parentId];
    if (!parent) return tree; // parent not loaded (e.g. stale event) — ignore
    foldersById[parentId] = { ...parent, folderIds: [...parent.folderIds, folder._id] };
    return { ...tree, foldersById };
  }

  return { ...tree, foldersById, root: { ...tree.root, folderIds: [...tree.root.folderIds, folder._id] } };
}

export function insertFile(tree, file) {
  if (!tree || tree.filesById[file._id]) return tree;

  const filesById = { ...tree.filesById, [file._id]: file };
  const parentId = file.folderId ?? null;

  if (parentId) {
    const parent = tree.foldersById[parentId];
    if (!parent) return tree;
    const foldersById = { ...tree.foldersById, [parentId]: { ...parent, fileIds: [...parent.fileIds, file._id] } };
    return { ...tree, filesById, foldersById };
  }

  return { ...tree, filesById, root: { ...tree.root, fileIds: [...tree.root.fileIds, file._id] } };
}

export function renameFolderInTree(tree, folderId, name) {
  const folder = tree?.foldersById[folderId];
  if (!folder || folder.name === name) return tree;
  return { ...tree, foldersById: { ...tree.foldersById, [folderId]: { ...folder, name } } };
}

export function renameFileInTree(tree, fileId, name) {
  const file = tree?.filesById[fileId];
  if (!file || file.name === name) return tree;
  return { ...tree, filesById: { ...tree.filesById, [fileId]: { ...file, name } } };
}

function removeFromParentFolders(tree, folderId) {
  return { ...tree, folderIds: tree.folderIds.filter(id => id !== folderId) };
}

function removeFromParentFiles(tree, fileId) {
  return { ...tree, fileIds: tree.fileIds.filter(id => id !== fileId) };
}

export function removeFolder(tree, folder) {
  const folderId = folder._id;
  if (!tree || !tree.foldersById[folderId]) return tree;

  const foldersById = { ...tree.foldersById };
  const existing = foldersById[folderId];
  delete foldersById[folderId];

  const parentId = existing.parentFolderId ?? null;
  if (parentId && foldersById[parentId]) {
    foldersById[parentId] = removeFromParentFolders(foldersById[parentId], folderId);
    return { ...tree, foldersById };
  }

  return { ...tree, foldersById, root: removeFromParentFolders(tree.root, folderId) };
}

export function removeFile(tree, file) {
  const fileId = file._id;
  if (!tree || !tree.filesById[fileId]) return tree;

  const filesById = { ...tree.filesById };
  const existing = filesById[fileId];
  delete filesById[fileId];

  const parentId = existing.folderId ?? null;
  if (parentId && tree.foldersById[parentId]) {
    const foldersById = { ...tree.foldersById, [parentId]: removeFromParentFiles(tree.foldersById[parentId], fileId) };
    return { ...tree, filesById, foldersById };
  }

  return { ...tree, filesById, root: removeFromParentFiles(tree.root, fileId) };
}

/**
 * moveFileInTree / moveFolderInTree — remove from the old parent
 * bucket and insert into the new one. No-op if the node isn't loaded
 * or is already in the target location (covers the self-echo case
 * and duplicate/out-of-order remote events alike).
 */
export function moveFileInTree(tree, { _id, folderId }) {
  const file = tree?.filesById[_id];
  if (!file) return tree;

  const targetFolderId = folderId ?? null;
  const currentFolderId = file.folderId ?? null;
  if (currentFolderId === targetFolderId) return tree;

  const withoutFile = removeFile(tree, file);
  return insertFile(withoutFile, { ...file, folderId: targetFolderId });
}

export function moveFolderInTree(tree, { _id, parentFolderId }) {
  const folder = tree?.foldersById[_id];
  if (!folder) return tree;

  const targetParentId = parentFolderId ?? null;
  const currentParentId = folder.parentFolderId ?? null;
  if (currentParentId === targetParentId) return tree;

  const withoutFolder = removeFolder(tree, folder);
  return insertFolder(withoutFolder, { ...folder, parentFolderId: targetParentId });
}

/**
 * isFolderOrDescendant — true if `nodeId` is `ancestorId` itself, or
 * nested anywhere under it. Call as
 * `isFolderOrDescendant(tree, draggedFolderId, dropTargetFolderId)`
 * to block a drag-and-drop move that would make a folder its own
 * descendant (the backend only rejects the direct "move into itself"
 * case, not deeper cycles — see folderService.moveFolder).
 */
export function isFolderOrDescendant(tree, ancestorId, nodeId) {
  if (!tree || !ancestorId || !nodeId) return false;
  if (ancestorId === nodeId) return true;

  let current = tree.foldersById[nodeId];
  const visited = new Set();
  while (current?.parentFolderId) {
    if (visited.has(current.parentFolderId)) return false; // corrupt/cyclic data guard
    visited.add(current.parentFolderId);
    if (current.parentFolderId === ancestorId) return true;
    current = tree.foldersById[current.parentFolderId];
  }
  return false;
}
