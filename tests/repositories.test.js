const { randomUUID } = require("node:crypto");
const path = require("node:path");
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const env = require("../src/config/env");
const testDatabaseUrl = env.DATABASE_URL;
const createdUserIds = new Set();
const createdProjectIds = new Set();

let db;
let userRepository;
let projectRepository;
let ruleRepository;
let eventRepository;

function parseDatabaseUrl(databaseUrl, variableName) {
	let parsedUrl;

	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new Error(`${variableName} must be a valid PostgreSQL connection URL`);
	}

	if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
		throw new Error(`${variableName} must use the PostgreSQL protocol`);
	}

	return {
		hostname: parsedUrl.hostname,
		port: parsedUrl.port || "5432",
		databaseName: decodeURIComponent(parsedUrl.pathname.slice(1)),
	};
}

function ensureIsolatedTestDatabase() {
	if (process.env.NODE_ENV !== "test") {
		throw new Error("Repository integration tests require NODE_ENV=test");
	}

	if (!testDatabaseUrl) {
		throw new Error("Repository integration tests require TEST_DATABASE_URL");
	}

	const isolatedDatabase = parseDatabaseUrl(testDatabaseUrl, "DATABASE_URL from .env.test");

	if (!/(^|[_-])test($|[_-])/i.test(isolatedDatabase.databaseName)) {
		throw new Error("TEST_DATABASE_URL must target a database with 'test' in its name");
	}
}

async function createUser() {
	const user = await userRepository.create({
		username: `repository-test-${randomUUID()}`,
		password_hash: "test-password-hash",
	});

	createdUserIds.add(user.id);
	return user;
}

async function createProject(user, overrides = {}) {
	const project = await projectRepository.create({
		user_id: user.id,
		name: `Repository test project ${randomUUID()}`,
		project_key: `repository-test-${randomUUID()}`,
		allowed_origins: [],
		enabled: true,
		...overrides,
	});

	createdProjectIds.add(project.id);
	return project;
}

async function createRule(project, overrides = {}) {
	return ruleRepository.create({
		project_id: project.id,
		name: `Repository test rule ${randomUUID()}`,
		priority: 0,
		enabled: true,
		conditions: {},
		action: "none",
		destination_url: null,
		frequency_enabled: false,
		frequency_seconds: null,
		frequency_mode: null,
		fullscreen_mode: "off",
		...overrides,
	});
}

async function createEvent(project, overrides = {}) {
	return eventRepository.create({
		project_id: project.id,
		rule_id: null,
		matched: false,
		triggered: false,
		reason: "repository_test",
		action: "none",
		...overrides,
	});
}

beforeAll(async () => {
	ensureIsolatedTestDatabase();

	db = require("../src/config/db");
	await db.migrate.latest({
		directory: path.resolve(process.cwd(), "src/db/migrations"),
	});

	userRepository = require("../src/repositories/userRepository");
	projectRepository = require("../src/repositories/projectRepository");
	ruleRepository = require("../src/repositories/ruleRepository");
	eventRepository = require("../src/repositories/eventRepository");
});

afterEach(async () => {
	for (const projectId of createdProjectIds) {
		await projectRepository.deleteById(projectId);
	}

	for (const userId of createdUserIds) {
		await userRepository.deleteById(userId);
	}

	createdProjectIds.clear();
	createdUserIds.clear();
});

afterAll(async () => {
	if (db) {
		await db.destroy();
	}

	if (originalDatabaseUrl === undefined) {
		delete process.env.DATABASE_URL;
	} else {
		process.env.DATABASE_URL = originalDatabaseUrl;
	}

	if (originalNodeEnv === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = originalNodeEnv;
	}
});

describe("userRepository", () => {
	it("creates and finds a user by ID and username", async () => {
		const user = await createUser();

		await expect(userRepository.findById(user.id)).resolves.toMatchObject({
			id: user.id,
			username: user.username,
			password_hash: "test-password-hash",
		});
		await expect(userRepository.findByUsername(user.username)).resolves.toMatchObject({
			id: user.id,
			username: user.username,
		});
	});

	it("deletes a user", async () => {
		const user = await createUser();

		await expect(userRepository.deleteById(user.id)).resolves.toBe(1);
		await expect(userRepository.findById(user.id)).resolves.toBeUndefined();
	});
});

describe("projectRepository", () => {
	it("creates and finds a project by ID and project key", async () => {
		const user = await createUser();
		const project = await createProject(user);

		await expect(projectRepository.findById(project.id)).resolves.toMatchObject({
			id: project.id,
			user_id: user.id,
			project_key: project.project_key,
		});
		await expect(projectRepository.findByProjectKey(project.project_key)).resolves.toMatchObject({
			id: project.id,
			project_key: project.project_key,
		});
	});

	it("inserts a one-element allowed_origins array as valid JSONB", async () => {
		const user = await createUser();
		const project = await createProject(user, {
			allowed_origins: ["http://localhost:5500"],
		});
		const readBack = await projectRepository.findById(project.id);
		expect(readBack.allowed_origins).toEqual(["http://localhost:5500"]);
	});

	it.each([
		[["http://localhost:5500"]],
		[["https://www.youtube.com", "http://localhost:5500"]],
	])("stores allowed origins as a JSON array", async (allowedOrigins) => {
		const user = await createUser();
		const project = await createProject(user, { allowed_origins: allowedOrigins });
		const readBack = await projectRepository.findById(project.id);

		expect(readBack.allowed_origins).toEqual(allowedOrigins);
		expect(Array.isArray(readBack.allowed_origins)).toBe(true);
	});

	it("updates allowed origins as a JSON array and supports an empty array", async () => {
		const user = await createUser();
		const project = await createProject(user, {
			allowed_origins: ["http://localhost:5500"],
		});

		const updatedProject = await projectRepository.updateById(project.id, {
			allowed_origins: ["https://www.youtube.com", "http://localhost:5500"],
		});
		expect(updatedProject.allowed_origins).toEqual([
			"https://www.youtube.com",
			"http://localhost:5500",
		]);
		expect(Array.isArray(updatedProject.allowed_origins)).toBe(true);

		const clearedProject = await projectRepository.updateById(project.id, {
			allowed_origins: [],
		});
		expect(clearedProject.allowed_origins).toEqual([]);
		expect(Array.isArray(clearedProject.allowed_origins)).toBe(true);
	});

	it("lists projects for their owning user", async () => {
		const user = await createUser();
		const otherUser = await createUser();
		const firstProject = await createProject(user);
		const secondProject = await createProject(user);
		await createProject(otherUser);

		const projects = await projectRepository.listByUserId(user.id);

		expect(projects.map(({ id }) => id)).toEqual(
			expect.arrayContaining([firstProject.id, secondProject.id]),
		);
		expect(projects).toHaveLength(2);
	});

	it("updates and deletes a project", async () => {
		const user = await createUser();
		const project = await createProject(user);

		await expect(
			projectRepository.updateById(project.id, { name: "Updated test project", enabled: false }),
		).resolves.toMatchObject({
			id: project.id,
			name: "Updated test project",
			enabled: false,
		});

		await expect(projectRepository.deleteById(project.id)).resolves.toBe(1);
		await expect(projectRepository.findById(project.id)).resolves.toBeUndefined();
	});
});

describe("ruleRepository", () => {
	it("creates and retrieves project rules in ascending priority order", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const lowerPriorityRule = await createRule(project, { name: "Lower priority", priority: 2 });
		const higherPriorityRule = await createRule(project, { name: "Higher priority", priority: 1 });

		await expect(ruleRepository.findById(lowerPriorityRule.id)).resolves.toMatchObject({
			id: lowerPriorityRule.id,
			project_id: project.id,
		});

		const rules = await ruleRepository.listByProjectId(project.id);
		expect(rules.map(({ id }) => id)).toEqual([higherPriorityRule.id, lowerPriorityRule.id]);
	});

	it("updates and deletes a rule", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const rule = await createRule(project);

		await expect(ruleRepository.updateById(rule.id, { name: "Updated test rule", priority: 5 }))
			.resolves.toMatchObject({ id: rule.id, name: "Updated test rule", priority: 5 });

		await expect(ruleRepository.deleteById(rule.id)).resolves.toBe(1);
		await expect(ruleRepository.findById(rule.id)).resolves.toBeUndefined();
	});
});

describe("eventRepository", () => {
	it("creates and lists project events newest first with limit and offset", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const baseTime = Date.now();
		const oldest = await createEvent(project, {
			created_at: new Date(baseTime).toISOString(),
			reason: "oldest",
		});
		const middle = await createEvent(project, {
			created_at: new Date(baseTime + 1000).toISOString(),
			reason: "middle",
		});
		const newest = await createEvent(project, {
			created_at: new Date(baseTime + 2000).toISOString(),
			reason: "newest",
		});

		const allEvents = await eventRepository.listByProjectId(project.id);
		expect(allEvents.map(({ id }) => id)).toEqual([newest.id, middle.id, oldest.id]);
		expect(allEvents[0]).toMatchObject({ id: newest.id, reason: "newest" });
		expect(Object.keys(allEvents[0]).sort()).toEqual([
			"action",
			"browser",
			"country",
			"created_at",
			"device_type",
			"id",
			"matched",
			"os",
			"project_id",
			"reason",
			"region",
			"rule_id",
			"triggered",
		]);

		const limitedEvents = await eventRepository.listByProjectId(project.id, { limit: 2 });
		expect(limitedEvents.map(({ id }) => id)).toEqual([newest.id, middle.id]);

		const offsetEvents = await eventRepository.listByProjectId(project.id, { offset: 1 });
		expect(offsetEvents.map(({ id }) => id)).toEqual([middle.id, oldest.id]);
		await expect(eventRepository.countByProjectId(project.id)).resolves.toBe(3);
	});

	it("orders events with matching timestamps by descending ID", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const createdAt = new Date().toISOString();
		const lowerId = await createEvent(project, {
			id: "00000000-0000-4000-8000-000000000001",
			created_at: createdAt,
		});
		const higherId = await createEvent(project, {
			id: "00000000-0000-4000-8000-000000000002",
			created_at: createdAt,
		});

		await expect(eventRepository.listByProjectId(project.id))
			.resolves.toMatchObject([{ id: higherId.id }, { id: lowerId.id }]);
		await expect(eventRepository.countByProjectId(project.id)).resolves.toBe(2);
	});

	it("counts no events for an empty project", async () => {
		const user = await createUser();
		const project = await createProject(user);

		await expect(eventRepository.countByProjectId(project.id)).resolves.toBe(0);
	});
});

describe("repository foreign keys", () => {
	it("cascades project deletion to its rules and events", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const rule = await createRule(project);
		await createEvent(project, { rule_id: rule.id });

		await expect(projectRepository.deleteById(project.id)).resolves.toBe(1);
		await expect(ruleRepository.findById(rule.id)).resolves.toBeUndefined();
		await expect(eventRepository.listByProjectId(project.id)).resolves.toEqual([]);
	});

	it("sets an event's rule ID to null when that rule is deleted", async () => {
		const user = await createUser();
		const project = await createProject(user);
		const rule = await createRule(project);
		const event = await createEvent(project, { rule_id: rule.id });

		await ruleRepository.deleteById(rule.id);

		await expect(db("events").where({ id: event.id }).first()).resolves.toMatchObject({
			id: event.id,
			rule_id: null,
		});
	});
});
