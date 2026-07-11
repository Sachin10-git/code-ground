const express = require("express");

const router = express.Router();

const {
    createProject,
    getProjects,
    getProjectById,
    updateProject,
    deleteProject,
    leaveWorkspace,
    getProjectMembers
} = require("../controllers/projectController");

const {
    validateCreateProject,
    validateUpdateProject,
    validateProjectId,
    validate
} = require("../validators/projectValidator");

/*
|--------------------------------------------------------------------------
| Workspace Routes
|--------------------------------------------------------------------------
*/

// Create Workspace
router.post(
    "/",
    validateCreateProject,
    validate,
    createProject
);

// Get All Workspaces
router.get(
    "/",
    getProjects
);

// Get Workspace By ID
router.get(
    "/:id",
    validateProjectId,
    validate,
    getProjectById
);

router.get(
    "/:id/members",
    validateProjectId,
    validate,
    getProjectMembers
);

// Rename Workspace
router.patch(
    "/:id",
    validateUpdateProject,
    validate,
    updateProject
);

// Delete Workspace
router.delete(
    "/:id",
    validateProjectId,
    validate,
    deleteProject
);

router.post(
    "/:id/leave",
    leaveWorkspace
);
module.exports = router;