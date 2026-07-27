const express = require("express");
const authenticate = require("../middleware/authenticate");
const snapshotController = require("../controllers/snapshotController");
const { validateSnapshotName, validate } = require("../validators/snapshotValidator");

const router = express.Router();

/**
 * Create Snapshot
 */
router.post(
    "/:projectId/snapshots",
    authenticate,
    validateSnapshotName,
    validate,
    snapshotController.createSnapshot
);

/**
 * List Snapshots
 */
router.get(
    "/:projectId/snapshots",
    authenticate,
    snapshotController.listSnapshots
);

/**
 * Rename Snapshot
 */
router.patch(
    "/snapshots/:snapshotId",
    authenticate,
    validateSnapshotName,
    validate,
    snapshotController.renameSnapshot
);

/**
 * Delete Snapshot
 */
router.delete(
    "/snapshots/:snapshotId",
    authenticate,
    snapshotController.deleteSnapshot
);

/**
 * Restore Snapshot
 */
router.post(
    "/snapshots/:snapshotId/restore",
    authenticate,
    snapshotController.restoreSnapshot
);

module.exports = router;
