const express = require("express");

const router = express.Router();

const authenticate = require("../middleware/authenticate");
const authorizeProject = require("../middleware/authorizeProject");

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
    authenticate,
    validateCreateProject,
    validate,
    createProject
);

// Get All Workspaces
router.get(
    "/",
    authenticate,
    getProjects
);

// Get Workspace By ID
router.get(
    "/:id",
    authenticate,
    authorizeProject(),
    validateProjectId,
    validate,
    getProjectById
);

// Get Workspace Members
router.get(
    "/:id/members",
    authenticate,
    authorizeProject(),
    validateProjectId,
    validate,
    getProjectMembers
);

// Rename Workspace (Owner Only)
router.patch(
    "/:id",
    authenticate,
    authorizeProject("owner"),
    validateUpdateProject,
    validate,
    updateProject
);

// Delete Workspace (Owner Only)
router.delete(
    "/:id",
    authenticate,
    authorizeProject("owner"),
    validateProjectId,
    validate,
    deleteProject
);

// Leave Workspace
router.post(
    "/:id/leave",
    authenticate,
    authorizeProject(),
    leaveWorkspace
);

module.exports = router;