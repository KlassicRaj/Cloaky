/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
	await knex.schema.createTable("users", (table) => {
		table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
		table.string("username").notNullable().unique();
		table.string("password_hash").notNullable();
		table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
		table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
	});

	await knex.schema.createTable("projects", (table) => {
		table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
		table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
		table.string("name").notNullable();
		table.string("project_key").notNullable().unique();
		table.jsonb("allowed_origins").notNullable().defaultTo("[]");
		table.boolean("enabled").notNullable().defaultTo(true);
		table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
		table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
	});

	await knex.schema.createTable("rules", (table) => {
		table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
		table.uuid("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
		table.string("name").notNullable();
		table.integer("priority").notNullable().defaultTo(0);
		table.boolean("enabled").notNullable().defaultTo(true);
		table.jsonb("conditions").notNullable().defaultTo("{}");
		table.string("action").notNullable();
		table.text("destination_url").nullable();
		table.boolean("frequency_enabled").notNullable().defaultTo(false);
		table.integer("frequency_seconds").nullable();
		table.string("frequency_mode").nullable();
		table.string("fullscreen_mode").notNullable();
		table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
		table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
		table.index(["project_id", "priority"]);
	});

	await knex.schema.createTable("events", (table) => {
		table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
		table.uuid("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
		table.uuid("rule_id").nullable().references("id").inTable("rules").onDelete("SET NULL");
		table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
		table.boolean("matched").notNullable().defaultTo(false);
		table.boolean("triggered").notNullable().defaultTo(false);
		table.string("reason").notNullable();
		table.string("action").notNullable();
		table.string("country").nullable();
		table.string("region").nullable();
		table.string("device_type").nullable();
		table.string("browser").nullable();
		table.string("os").nullable();
		table.index(["project_id", "created_at"]);
	});
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
	await knex.schema.dropTableIfExists("events");
	await knex.schema.dropTableIfExists("rules");
	await knex.schema.dropTableIfExists("projects");
	await knex.schema.dropTableIfExists("users");
};
