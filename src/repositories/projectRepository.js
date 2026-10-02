const db = require("../config/db");

module.exports = {
	async findById(id) {
		return db("projects").where({ id }).first();
	},

	async findByProjectKey(projectKey) {
		return db("projects").where({ project_key: projectKey }).first();
	},

	async listByUserId(userId) {
		return db("projects").where({ user_id: userId });
	},

	async create(project) {
		const [createdProject] = await db("projects").insert(project).returning("*");
		return createdProject;
	},

	async updateById(id, updates) {
		const [updatedProject] = await db("projects")
			.where({ id })
			.update(updates)
			.returning("*");
		return updatedProject;
	},

	async deleteById(id) {
		return db("projects").where({ id }).delete();
	},
};
