const bcrypt = require("bcryptjs");
const env = require("../src/config/env");
const db = require("../src/config/db");
const userRepository = require("../src/repositories/userRepository");

async function provisionAdmin({
    username = env.ADMIN_USERNAME,
    passwordHash = env.ADMIN_PASSWORD_HASH,
    userRepository: repository = userRepository,
} = {}) {
    username = typeof username === "string" ? username.trim() : "";

    if (!username || !passwordHash) {
        throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be configured");
    }

    let rounds;
    try {
        rounds = bcrypt.getRounds(passwordHash);
    } catch {
        throw new Error("ADMIN_PASSWORD_HASH must be a valid bcrypt hash");
    }
    if (!Number.isInteger(rounds) || rounds < 10 || rounds > 14) {
        throw new Error("ADMIN_PASSWORD_HASH must use bcrypt cost 10 through 14");
    }

    if (await repository.findByUsername(username)) {
        throw new Error("Admin user already exists; no account was changed");
    }

    try {
        await repository.create({ username, password_hash: passwordHash });
    } catch (error) {
        if (error?.code === "23505") {
            throw new Error("Admin user already exists; no account was changed");
        }
        throw new Error("Admin provisioning failed");
    }
}

if (require.main === module) {
    provisionAdmin()
        .then(() => console.log("Initial admin account provisioned."))
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(() => db.destroy());
}

module.exports = { provisionAdmin };