const env = require("./src/config/env");

module.exports = {
    development: {
        client: "pg",
        connection: env.DATABASE_URL,
        migrations: {
            directory: "./src/db/migrations",
        },
    },

    test: {
        client: "pg",
        connection: env.DATABASE_URL,
        migrations: {
            directory: "./src/db/migrations",
        },
    },

    production: {
        client: "pg",
        connection: env.DATABASE_URL,
        migrations: {
            directory: "./src/db/migrations",
        },
    },
};