const { randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");

let dummyHashPromise;

function getDummyHash() {
    if (!dummyHashPromise) {
        dummyHashPromise = bcrypt.hash(randomBytes(32).toString("hex"), 12);
    }
    return dummyHashPromise;
}

function createAuthService({ userRepository }) {
    return {
        async authenticate(username, password) {
            const user = await userRepository.findByUsername(username);
            const passwordHash = user?.password_hash || await getDummyHash();

            let passwordMatches = false;
            try {
                passwordMatches = await bcrypt.compare(password, passwordHash);
            } catch {
                passwordMatches = false;
            }

            return user && passwordMatches ? user : null;
        },
    };
}

module.exports = { createAuthService };