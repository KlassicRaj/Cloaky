const db = require("../config/db");

module.exports = {
	async findById(id) {
		return db("users").where({ id }).first();
	},

	async findByUsername(username) {
		return db("users").where({ username }).first();
	},

	async create(user) {
		const [createdUser] = await db("users").insert(user).returning("*");
		return createdUser;
	},

	async deleteById(id) {
		return db("users").where({ id }).delete();
	},
};
