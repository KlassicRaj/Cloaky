const db = require("../config/db");

module.exports = {
	async create(event) {
		const [createdEvent] = await db("events").insert(event).returning("*");
		return createdEvent;
	},

	async listByProjectId(projectId, options = {}) {
		const query = db("events")
			.where({ project_id: projectId })
			.orderBy("created_at", "desc");

		if (options.limit !== undefined) {
			query.limit(options.limit);
		}

		if (options.offset !== undefined) {
			query.offset(options.offset);
		}

		return query;
	},
};
