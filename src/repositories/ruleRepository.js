const db = require("../config/db");

module.exports = {
	async findById(id) {
		return db("rules").where({ id }).first();
	},

	async listByProjectId(projectId) {
		return db("rules")
			.where({ project_id: projectId })
			.orderBy("priority", "asc");
	},

	async create(rule) {
		const [createdRule] = await db("rules").insert(rule).returning("*");
		return createdRule;
	},

	async updateById(id, updates) {
		const [updatedRule] = await db("rules")
			.where({ id })
			.update(updates)
			.returning("*");
		return updatedRule;
	},

	async deleteById(id) {
		return db("rules").where({ id }).delete();
	},
};
