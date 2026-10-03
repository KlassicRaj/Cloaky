const express = require("express");
const { createEventController } = require("../controllers/eventController");

function createEventsRouter({ eventService }) {
    const router = express.Router();
    const controller = createEventController({ eventService });

    router.get("/:projectId/events", controller.list);

    return router;
}

module.exports = { createEventsRouter };
