import { describe, expect, it, vi } from "vitest";

const bcrypt = require("bcryptjs");
const request = require("supertest");
const { createApp } = require("../src/server");
const { createAuthService } = require("../src/services/authService");
const { createSessionService } = require("../src/services/sessionService");
const { createProjectService } = require("../src/services/projectService");
const { provisionAdmin } = require("../scripts/provisionAdmin");

const sessionSecret = "auth-api-tests-session-secret-longer-than-32-bytes";
const owner = { id: "a3fd3a30-6f04-48ba-b440-700f9f8398fc", username: "owner" };
const credentials = { username: owner.username, password: "correct horse battery staple" };
const projectId = "8e5efb54-49f0-4ce4-b224-90f8365d8e20";

function allowAll(req, res, next) {
    return next();
}

async function createAuthTestApp({
    userRepository,
    projectService,
    projectRepository,
    evaluationService,
    sessionService,
    cookieSecure = false,
} = {}) {
    const userRepo = userRepository || {
        findByUsername: vi.fn().mockResolvedValue(owner),
        findById: vi.fn().mockImplementation(async (id) => id === owner.id ? owner : null),
    };
    const passwordHash = await bcrypt.hash(credentials.password, 10);
    if (userRepository === undefined) {
        userRepo.findByUsername.mockResolvedValue({ ...owner, password_hash: passwordHash });
    }

    const actualSessionService = sessionService || createSessionService({ secret: sessionSecret });
    const actualProjectRepository = projectRepository || {
        findById: vi.fn().mockResolvedValue({ id: projectId, user_id: owner.id }),
        findByProjectKey: vi.fn().mockResolvedValue({
            id: projectId,
            project_key: "public-key",
            allowed_origins: ["https://client.example"],
            enabled: true,
        }),
    };
    const actualProjectService = projectService || {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: projectId }),
        getById: vi.fn().mockResolvedValue({ id: projectId }),
        updateById: vi.fn().mockResolvedValue({ id: projectId }),
        deleteById: vi.fn().mockResolvedValue(true),
    };
    const actualEvaluationService = evaluationService || {
        evaluate: vi.fn().mockResolvedValue({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        }),
    };

    const app = createApp({
        userRepository: userRepo,
        projectRepository: actualProjectRepository,
        projectService: actualProjectService,
        ruleService: { listByProjectId: vi.fn().mockResolvedValue([]) },
        evaluationService: actualEvaluationService,
        authService: createAuthService({ userRepository: userRepo }),
        sessionService: actualSessionService,
        cookieSecure,
        loginRateLimitMiddleware: allowAll,
        rateLimitMiddleware: allowAll,
    });

    return {
        app,
        userRepository: userRepo,
        projectService: actualProjectService,
        projectRepository: actualProjectRepository,
        evaluationService: actualEvaluationService,
        sessionService: actualSessionService,
    };
}

describe("authentication API", () => {
    it("authenticates valid credentials and issues a protected session cookie", async () => {
        const { app } = await createAuthTestApp();
        const response = await request(app).post("/api/auth/login").send(credentials).expect(200);
        const cookie = response.headers["set-cookie"][0];

        expect(response.body).toEqual({ authenticated: true });
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Strict");
        expect(cookie).toContain("Path=/api");
        expect(cookie).not.toContain(credentials.password);
        expect(JSON.stringify(response.body)).not.toContain(owner.id);
    });

    it("uses the configured secure-cookie setting", async () => {
        const { app } = await createAuthTestApp({ cookieSecure: true });
        const response = await request(app).post("/api/auth/login").send(credentials).expect(200);

        expect(response.headers["set-cookie"][0]).toContain("Secure");
    });

    it("returns the same generic failure for unknown users and incorrect passwords", async () => {
        const { app, userRepository } = await createAuthTestApp();
        const wrongPassword = await request(app)
            .post("/api/auth/login")
            .send({ ...credentials, password: "incorrect password" })
            .expect(401);

        userRepository.findByUsername.mockResolvedValue(null);
        const unknownUser = await request(app)
            .post("/api/auth/login")
            .send({ username: "missing-user", password: "incorrect password" })
            .expect(401);

        expect(wrongPassword.body).toEqual({ error: "invalid_credentials" });
        expect(unknownUser.body).toEqual(wrongPassword.body);
    });

    it("validates login request bodies", async () => {
        const { app, userRepository } = await createAuthTestApp();

        await request(app).post("/api/auth/login").send({ username: "owner" }).expect(400);
        await request(app).post("/api/auth/login").send({ ...credentials, extra: "not allowed" }).expect(400);
        expect(userRepository.findByUsername).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated and malformed-cookie management requests", async () => {
        const { app } = await createAuthTestApp();

        await request(app).get(`/api/projects/${projectId}`).expect(401);
        await request(app).get(`/api/projects/${projectId}/rules`).expect(401);
        await request(app)
            .get(`/api/projects/${projectId}`)
            .set("Cookie", "visitor_routing_session=not.a.valid.session")
            .expect(401);
    });

    it("rejects tampered sessions and sessions for deleted users", async () => {
        const { app, sessionService, userRepository } = await createAuthTestApp();
        const token = sessionService.createSession(owner.id).token;
        const [payload, signature] = token.split(".");
        const tampered = `${payload}.${signature[0] === "x" ? "y" : "x"}${signature.slice(1)}`;

        await request(app)
            .get(`/api/projects/${projectId}`)
            .set("Cookie", `visitor_routing_session=${tampered}`)
            .expect(401);

        userRepository.findById.mockResolvedValue(null);
        await request(app)
            .get(`/api/projects/${projectId}`)
            .set("Cookie", `visitor_routing_session=${token}`)
            .expect(401);
    });

    it("authorizes management requests from the signed user ID, not a client user ID", async () => {
        const { app, projectService } = await createAuthTestApp();
        const agent = request.agent(app);

        await agent.post("/api/auth/login").send(credentials).expect(200);
        await agent
            .get(`/api/projects/${projectId}`)
            .query({ userId: "attacker-selected-id" })
            .expect(200);
        expect(projectService.getById).toHaveBeenCalledWith(projectId, owner.id);
    });

    it("denies cross-user project access", async () => {
        const userB = { id: "b3fd3a30-6f04-48ba-b440-700f9f8398fc", username: "user-b" };
        const passwordHash = await bcrypt.hash(credentials.password, 10);
        const userRepository = {
            findByUsername: vi.fn().mockResolvedValue({ ...userB, password_hash: passwordHash }),
            findById: vi.fn().mockResolvedValue(userB),
        };
        const projectRepository = {
            findById: vi.fn().mockResolvedValue({ id: projectId, user_id: owner.id }),
        };
        const projectService = createProjectService({
            projectRepository,
            userRepository,
        });
        const { app } = await createAuthTestApp({ userRepository, projectRepository, projectService });
        const agent = request.agent(app);

        await agent.post("/api/auth/login").send(credentials).expect(200);
        await agent.get(`/api/projects/${projectId}`).expect(404);
    });

    it("clears the session cookie on logout and denies subsequent access", async () => {
        const { app } = await createAuthTestApp();
        const agent = request.agent(app);

        await agent.post("/api/auth/login").send(credentials).expect(200);
        await agent.get(`/api/projects/${projectId}`).expect(200);
        const logout = await agent.post("/api/auth/logout").expect(200);

        expect(logout.body).toEqual({ loggedOut: true });
        expect(logout.headers["set-cookie"][0]).toContain("Path=/api");
        await agent.get(`/api/projects/${projectId}`).expect(401);
    });

    it("leaves health, SDK, evaluation, redirect, and evaluation preflight public", async () => {
        const { app, evaluationService } = await createAuthTestApp();

        await request(app).get("/health").expect(200);
        await request(app).get("/sdk.js").expect(200);
        await request(app)
            .post("/api/v1/evaluate?projectKey=public-key")
            .send({ browser: "Chrome" })
            .expect(200);
        await request(app).get("/r/public-key").expect(204);
        await request(app)
            .options("/api/v1/evaluate?projectKey=public-key")
            .set("Origin", "https://client.example")
            .set("Access-Control-Request-Method", "POST")
            .expect(204);

        expect(evaluationService.evaluate).toHaveBeenCalledTimes(2);
    });
});

describe("initial admin provisioning", () => {
    it("inserts a bcrypt hash once and refuses to overwrite an existing user", async () => {
        const hash = await bcrypt.hash("provisioning test password", 10);
        const userRepository = {
            findByUsername: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: owner.id }),
            create: vi.fn().mockResolvedValue({ id: owner.id }),
        };

        await provisionAdmin({ username: "owner", passwordHash: hash, userRepository });
        expect(userRepository.create).toHaveBeenCalledWith({ username: "owner", password_hash: hash });
        await expect(provisionAdmin({ username: "owner", passwordHash: hash, userRepository }))
            .rejects.toThrow("already exists");
        expect(userRepository.create).toHaveBeenCalledTimes(1);
    });
});
