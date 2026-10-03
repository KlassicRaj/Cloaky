const express = require("express");
const { createProjectController } = require("../controllers/projectController");

function createProjectsRouter({ projectService }) {
    const router = express.Router();
    const controller = createProjectController({ projectService });

    router.get("/", controller.list);
    router.post("/", controller.create);
    router.get("/:projectId", controller.getById);
    router.patch("/:projectId", controller.updateById);
    router.delete("/:projectId", controller.deleteById);

    return router;
}

module.exports = { createProjectsRouter };