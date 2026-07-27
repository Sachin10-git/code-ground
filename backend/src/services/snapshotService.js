const Y = require("yjs");

const File = require("../models/file");
const Folder = require("../models/folder");
const Snapshot = require("../models/snapshot");
const CRDTDocument = require("../db/models/crdtDocument");
const CRDTSnapshot = require("../db/models/crdtSnapshot");

const projectService = require("./projectService");
const fileService = require("./fileService");
const ApiError = require("../utils/ApiError");

const { hasDocument, getDocument, getSharedText } = require("../crdt/yjsManager");
const { saveDocument } = require("../crdt/persistenceManager");
const { clearSaveTimer } = require("../crdt/debounceManager");
const { getIO } = require("../socket/socketServer");
const SOCKET_EVENTS = require("../socket/socketConstants");

/**
 * Phase 6.7 — Snapshots.
 *
 * A Snapshot captures a project's full folder hierarchy + every
 * file's content at a point in time (see models/snapshot.js). Create/
 * list/rename follow the exact same "load doc -> check membership ->
 * mutate" shape as fileService/folderService; restore is the one
 * operation that reaches into the live Yjs layer (crdt/yjsManager.js)
 * because a file being actively edited has content that hasn't been
 * saved to File.content yet (see fileService.updateFileContent's
 * docstring for why those two stores can drift).
 */

/**
 * Create Snapshot
 *
 * Reuses fileService.getProjectTree for the folders/files query (same
 * membership check, same data fileController.getProjectTree already
 * returns to the Explorer) rather than duplicating that query here.
 * For each file, overlays LIVE content where a collaboration room is
 * currently active, so a snapshot taken mid-edit captures what's
 * actually on everyone's screen, not just the last explicit Save.
 */
const createSnapshot = async (projectId, userId, username, { name } = {}) => {

    const { folders, files } = await fileService.getProjectTree(projectId, userId);

    const snapshotFiles = files.map((file) => {
        const roomId = file._id.toString();
        const content = hasDocument(roomId)
            ? getSharedText(roomId).toString()
            : file.content;

        return {
            fileId: file._id,
            name: file.name,
            folderId: file.folderId ?? null,
            language: file.language,
            content,
        };
    });

    const snapshotFolders = folders.map((folder) => ({
        folderId: folder._id,
        name: folder.name,
        parentFolderId: folder.parentFolderId ?? null,
    }));

    const snapshot = await Snapshot.create({
        projectId,
        name: (name || "").trim(),
        createdBy: userId,
        createdByUsername: username,
        fileCount: snapshotFiles.length,
        folders: snapshotFolders,
        files: snapshotFiles,
    });

    return snapshot;

};

/**
 * List Snapshots
 *
 * `changedFiles` is computed against a single fresh fetch of the
 * project's CURRENT files (one query for the whole list, not one per
 * snapshot) — a file counts as changed if its content differs from
 * what the snapshot captured, or no longer exists at all.
 */
const listSnapshots = async (projectId, userId) => {

    const isMember = await projectService.isProjectMember(projectId, userId);

    if (!isMember) {
        throw new ApiError(403, "You are not a member of this workspace");
    }

    const snapshots = await Snapshot.find({ projectId }).sort({ createdAt: -1 });

    const currentFiles = await File.find({ projectId }).select("_id content");
    const currentContentById = new Map(
        currentFiles.map((file) => [file._id.toString(), file.content])
    );

    return snapshots.map((snapshot) => {
        const changedFiles = snapshot.files.filter((file) => {
            const current = currentContentById.get(file.fileId.toString());
            return current === undefined || current !== file.content;
        }).length;

        return {
            ...snapshot.toObject(),
            changedFiles,
        };
    });

};

/**
 * Rename Snapshot
 */
const renameSnapshot = async (snapshotId, userId, name) => {

    const snapshot = await Snapshot.findById(snapshotId);

    if (!snapshot) {
        throw new ApiError(404, "Snapshot not found");
    }

    const canEdit = await projectService.isProjectEditor(snapshot.projectId, userId);

    if (!canEdit) {
        throw new ApiError(403, "You do not have permission to modify snapshots in this workspace");
    }

    const oldName = snapshot.name || "Untitled snapshot";

    snapshot.name = (name || "").trim();

    await snapshot.save();

    return { snapshot, oldName };

};

/**
 * Delete Snapshot
 */
const deleteSnapshot = async (snapshotId, userId) => {

    const snapshot = await Snapshot.findById(snapshotId);

    if (!snapshot) {
        throw new ApiError(404, "Snapshot not found");
    }

    const canEdit = await projectService.isProjectEditor(snapshot.projectId, userId);

    if (!canEdit) {
        throw new ApiError(403, "You do not have permission to modify snapshots in this workspace");
    }

    await Snapshot.findByIdAndDelete(snapshotId);

    return snapshot;

};

/**
 * Restore Snapshot
 *
 * Replaces every File/Folder in the project with what the snapshot
 * captured, preserving each one's ORIGINAL `_id` — this is what keeps
 * a restored file's Yjs room identity (roomId = fileId.toString(),
 * see crdt/yjsManager.js) valid across the restore for free.
 *
 * For every restored file:
 *   - any stale CRDTDocument/CRDTSnapshot for that room is dropped, so
 *     a file nobody currently has open reseeds correctly from the
 *     fresh File.content the next time anyone joins its room (see
 *     socketEvents.js's ensureFileSeed) instead of resurrecting
 *     pre-restore content.
 *   - if the room IS currently active (hasDocument), its live Y.Doc is
 *     forcibly rewritten and rebroadcast as a normal FILE_UPDATED to
 *     that file's Socket.IO room — every connected client's existing
 *     onFileUpdated handler (useYjs.js) applies it and y-monaco
 *     reflects the change immediately, with no new frontend code.
 */
const restoreSnapshot = async (snapshotId, userId) => {

    const snapshot = await Snapshot.findById(snapshotId);

    if (!snapshot) {
        throw new ApiError(404, "Snapshot not found");
    }

    const canEdit = await projectService.isProjectEditor(snapshot.projectId, userId);

    if (!canEdit) {
        throw new ApiError(403, "You do not have permission to restore snapshots in this workspace");
    }

    const projectId = snapshot.projectId;

    await Folder.deleteMany({ projectId });
    await File.deleteMany({ projectId });

    if (snapshot.folders.length) {
        await Folder.insertMany(snapshot.folders.map((folder) => ({
            _id: folder.folderId,
            projectId,
            name: folder.name,
            parentFolderId: folder.parentFolderId ?? null,
            createdBy: userId,
        })));
    }

    if (snapshot.files.length) {
        await File.insertMany(snapshot.files.map((file) => ({
            _id: file.fileId,
            projectId,
            folderId: file.folderId ?? null,
            name: file.name,
            language: file.language,
            content: file.content,
            createdBy: userId,
        })));
    }

    const io = getIO();

    for (const file of snapshot.files) {
        const roomId = file.fileId.toString();

        await CRDTDocument.deleteOne({ roomId });
        await CRDTSnapshot.deleteMany({ roomId });

        if (!hasDocument(roomId)) continue;

        clearSaveTimer(roomId);

        const doc = getDocument(roomId);
        const ytext = doc.getText("editor");

        doc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, file.content);
        }, "snapshot-restore");

        await saveDocument(roomId, doc);

        io.to(roomId).emit(SOCKET_EVENTS.FILE_UPDATED, {
            socketId: null,
            update: Y.encodeStateAsUpdate(doc),
        });
    }

    return snapshot;

};

module.exports = {
    createSnapshot,
    listSnapshots,
    renameSnapshot,
    deleteSnapshot,
    restoreSnapshot,
};
