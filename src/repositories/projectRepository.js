const db = require("../config/db");

function allowedOriginsJsonb(allowedOrigins) {
	return db.raw("to_jsonb(?::text[])", [allowedOrigins]);
}

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
		const values = { ...project };
		if (Array.isArray(values.allowed_origins)) {
			values.allowed_origins = allowedOriginsJsonb(values.allowed_origins);
		}
		const [createdProject] = await db("projects").insert(values).returning("*");
		return createdProject;
	},

	async updateById(id, updates) {
		const values = { ...updates };
		if (Array.isArray(values.allowed_origins)) {
			values.allowed_origins = allowedOriginsJsonb(values.allowed_origins);
		}
		const [updatedProject] = await db("projects")
			.where({ id })
			.update(values)
			.returning("*");
		return updatedProject;
	},

	async deleteById(id) {
		return db("projects").where({ id }).delete();
	},
};
