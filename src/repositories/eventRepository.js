const db = require("../config/db");

const eventColumns = [
	"id",
	"project_id",
	"rule_id",
	"created_at",
	"matched",
	"triggered",
	"reason",
	"action",
	"country",
	"region",
	"device_type",
	"browser",
	"os",
];

module.exports = {
	async create(event) {
		const [createdEvent] = await db("events").insert(event).returning("*");
		return createdEvent;
	},

	async listByProjectId(projectId, options = {}) {
		const query = db("events")
			.where({ project_id: projectId })
			.select(eventColumns)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");

		if (options.limit !== undefined) {
			query.limit(options.limit);
		}

		if (options.offset !== undefined) {
			query.offset(options.offset);
		}

		return query;
	},

	async countByProjectId(projectId) {
		const [result] = await db("events")
			.where({ project_id: projectId })
			.count({ total: "id" });
		const total = Number(result.total);
		if (!Number.isSafeInteger(total) || total < 0) {
			throw new Error("Event count is outside the supported numeric range");
		}
		return total;
	},
};
