const express = require("express");
const env = require("./config/env");
const healthRouter = require("./routes/health");

const app = express();

app.use(express.json());

app.use(healthRouter);

const PORT = env.PORT;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});