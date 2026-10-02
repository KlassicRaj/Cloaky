const express = require("express");
const env = require("./config/env");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
});

const PORT = env.PORT;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});