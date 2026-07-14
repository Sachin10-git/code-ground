const express = require("express");
const authenticate = require("../middleware/authenticate");
const fileController = require("../controllers/fileController");

const router = express.Router();

/**
 * Get Project Tree
 */
router.get(
    "/:projectId/tree",
    authenticate,
    fileController.getProjectTree
);
/**
 * Create File
 */
router.post(
    "/:projectId/files",
    authenticate,
    fileController.createFile
);
/**
 * Rename File
 */
router.patch(
    "/files/:fileId",
    authenticate,
    fileController.renameFile
);
/**
 * Move File
 */
router.patch(
    "/files/:fileId/move",
    authenticate,
    fileController.moveFile
);
/**
 * Delete File
 */
router.delete(
    "/files/:fileId",
    authenticate,
    fileController.deleteFile
);

module.exports = router;