const express = require("express");
const authenticate = require("../middleware/authenticate");
const folderController = require("../controllers/folderController");

const router = express.Router();

/**
 * Create Folder
 */
router.post(
    "/:projectId/folders",
    authenticate,
    folderController.createFolder
);

/**
 * Rename Folder
 */
router.patch(
    "/folders/:folderId",
    authenticate,
    folderController.renameFolder
);

/**
 * Move Folder
 */
router.patch(
    "/folders/:folderId/move",
    authenticate,
    folderController.moveFolder
);

/**
 * Delete Folder
 */
router.delete(
    "/folders/:folderId",
    authenticate,
    folderController.deleteFolder
);

module.exports = router;