const File = require("../models/file");
const Folder = require("../models/folder");
const Project = require("../db/models/project");
const projectService = require("./projectService");
const ApiError = require("../utils/ApiError");

const { hasDocument, getDocument } = require("../crdt/yjsManager");
const { saveDocument } = require("../crdt/persistenceManager");
const { clearSaveTimer } = require("../crdt/debounceManager");

/**
 * Create File
 */
const createFile = async (projectId, userId, fileData) => {

    const {
        name,
        folderId = null,
        language,
        content,
    } = fileData;

    // Check project exists
    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    // Check user is a member
    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    // Validate folder
    if (folderId) {

        const folder = await Folder.findById(folderId);

        if (!folder) {
            throw new ApiError(
                404,
                "Folder not found"
            );
        }

    }

    const file = await File.create({
        projectId,
        folderId,
        name,
        language,
        content,
        createdBy: userId,
    });

    return file;

};

/**
 * Get Project Tree
 */
const getProjectTree = async (projectId, userId) => {

    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(
            404,
            "Workspace not found"
        );
    }

    const folders = await Folder.find({ projectId })
        .sort({ createdAt: 1 });

    const files = await File.find({ projectId })
        .sort({ createdAt: 1 });

    return {
        project,
        folders,
        files,
    };

};

/**
 * Rename File
 */
const renameFile = async (fileId, userId, name) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    const oldName = file.name;

    file.name = name;

    await file.save();

    // Plain object (not the mongoose doc) so `oldName` — not a schema
    // field — survives JSON serialization for both the REST response
    // and workspaceBroadcast.js's rename payload/activity record.
    return { ...file.toObject(), oldName };

};

/**
 * Update File Content
 *
 * Persists the editor's content to File.content — but that alone isn't
 * enough to make a manual Save reliable: this file's live collaboration
 * room (if one is active — see crdt/yjsManager.js) is what actually
 * seeds the editor on every future ROOM_JOIN (see socketEvents.js),
 * and it's normally only flushed to CRDTDocument on a 2s debounce after
 * the user stops typing (see crdt/debounceManager.js). A user who edits
 * and immediately closes the tab — or just gets unlucky with timing —
 * could lose up to that 2s window even though File.content itself saved
 * correctly. Forcing an immediate flush here (only when a live room
 * actually exists for this file — hasDocument, never getDocument,
 * which would otherwise conjure a brand-new EMPTY doc and persist that
 * instead) makes manual Save authoritative regardless of the debounce
 * timer, per the Phase 6.6 requirement that it "force persistence"
 * rather than just trust autosave to have already happened.
 */
const updateFileContent = async (fileId, userId, content) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    file.content = content ?? "";

    await file.save();

    /* Phase 5.5: replace the live Y.Doc's text to EQUAL what was just
       saved, rather than trusting it already matches (the old "just
       flush whatever's currently there" approach) and persist that.
       hasDocument() only returns true for a room that finished the
       crdt/hydration.js pipeline (see yjsManager.js), so this never
       touches a room that's still mid-hydration. Replacing rather than
       flushing closes the remaining gap even a hydrated room can hit: a
       client-side timing gap between receiving DOCUMENT_SYNC and its
       MonacoBinding actually attaching, during which a save could land
       while the live doc still holds pre-edit content - flushing that
       verbatim would silently revert CRDTDocument out from under the
       File.content this save just correctly wrote. */
    if (hasDocument(fileId)) {
        clearSaveTimer(fileId);
        const doc = getDocument(fileId);
        const sharedText = doc.getText("editor");
        doc.transact(() => {
            sharedText.delete(0, sharedText.length);
            sharedText.insert(0, file.content);
        });
        await saveDocument(fileId, doc);
    }

    return file;

};

/**
 * Move File
 */
const moveFile = async (fileId, userId, folderId) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    if (folderId) {

        const folder = await Folder.findById(folderId);

        if (!folder) {
            throw new ApiError(
                404,
                "Destination folder not found"
            );
        }

    }

    file.folderId = folderId || null;

    await file.save();

    return file;

};

/**
 * Delete File
 */
const deleteFile = async (fileId, userId) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    await File.findByIdAndDelete(fileId);

    return file;

};

module.exports = {
    createFile,
    getProjectTree,
    renameFile,
    updateFileContent,
    moveFile,
    deleteFile,
};