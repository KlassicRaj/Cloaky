const express = require("express");
const path = require("node:path");

const publicDirectory = path.resolve(__dirname, "../../public");

function sendPage(fileName) {
    const filePath = path.join(publicDirectory, fileName);
    return (req, res, next) => {
        res.sendFile(filePath, (error) => {
            if (error) next(error);
        });
    };
}

function createDashboardRouter() {
    const router = express.Router();

    router.get("/login", sendPage("login.html"));
    router.get("/dashboard", sendPage("dashboard.html"));
    router.get("/dashboard/project.html", sendPage("project.html"));
    router.use("/assets", express.static(publicDirectory, {
        dotfiles: "deny",
        fallthrough: true,
        index: false,
    }));

    return router;
}

module.exports = { createDashboardRouter };
