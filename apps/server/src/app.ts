import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import { AuthService } from "./auth.js";
import type { WorkflowService } from "./workflow-service.js";

const agentIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });
const createAgentBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().max(10_000).optional(),
});
const updateAgentBody = createAgentBody.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);
const messageBody = z.object({
  content: z.string().trim().min(1).max(50_000),
});
const loginBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(8).max(200), honeypot: z.string().max(0).optional() });
const registerBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(8).max(200), securityKey: z.string().trim().min(3).max(200) });
const resetPasswordBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(8).max(200), securityKey: z.string().trim().min(3).max(200) });
const changePasswordBody = z.object({ password: z.string().min(8).max(200) });
const preferencesBody = z.object({ theme: z.enum(["system", "light", "dark", "sepia", "forest", "ocean"]), font: z.enum(["system", "serif", "dyslexia", "modern"]) });

export async function createApp(
  config: AppConfig,
  service: AgentService,
  auth: AuthService,
  workflows?: WorkflowService,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-launchpad-password", "req.headers.x-launchpad-security-key"],
    },
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin:
      config.nodeEnv === "development"
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : false,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/auth" || request.url === "/api/auth/login" || request.url === "/api/auth/register" || request.url === "/api/auth/reset-password" || request.url === "/api/auth/logout"
    ) {
      return;
    }
    if (!auth) return;
    try {
      (request as any).user = await auth.authenticate(
        String(request.headers["x-launchpad-username"] ?? ""),
        String(request.headers["x-launchpad-password"] ?? ""),
      );
    } catch {
      return reply.code(401).send({ error: "Sign in with username and password" });
    }
  });

  const owner = (request: any): string | undefined => request.user?.username;

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    if (body.honeypot) throw new HttpError(401, "Invalid username or password");
    return { user: await auth.login(body.username, body.password) };
  });
  app.post("/api/auth/register", async (request, reply) => {
    const body = registerBody.parse(request.body);
    return reply.code(201).send({ user: await auth.register(body.username, body.password, body.securityKey) });
  });
  app.post("/api/auth/reset-password", async (request) => {
    const body = resetPasswordBody.parse(request.body);
    await auth.resetPassword(body.username, body.securityKey, body.password);
    return { ok: true };
  });
  app.post("/api/auth/change-password", async (request) => {
    const user = (request as any).user;
    if (!user) throw new HttpError(401, "Account session required");
    const body = changePasswordBody.parse(request.body);
    await auth.changePassword(user.username, body.password);
    return { ok: true };
  });
  app.post("/api/auth/logout", async () => ({ ok: true }));
  app.get("/api/auth/me", async request => ({ user: (request as any).user }));
  app.get("/api/auth/preferences", async request => {
    const user = (request as any).user;
    if (!user) throw new HttpError(401, "Account session required");
    return { preferences: await auth.getPreferences(user.username) };
  });
  app.patch("/api/auth/preferences", async request => {
    const user = (request as any).user;
    if (!user) throw new HttpError(401, "Account session required");
    const body = preferencesBody.parse(request.body);
    return { preferences: await auth.savePreferences(user.username, body.theme, body.font) };
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "volc-agent-launchpad",
  }));

  app.get("/api/auth", async request => {
    return { required: true };
  });

  app.get("/api/system", async () => service.systemInfo());

  const workflowIdParams = z.object({ id: z.string().uuid() });
  const stageParams = z.object({ id: z.string().uuid(), stageId: z.string().uuid() });
  const workflowBody = z.object({ taskDescription: z.string().trim().min(1).max(50_000), templateId: z.string().optional(), createdBy: z.string().optional(), verificationProfile: z.enum(["thorough", "balanced", "token_saver"]).optional() });
  const feedbackBody = z.object({ feedback: z.string().trim().min(1).max(50_000) });
  const revisionBody = z.object({ prompt: z.string().trim().min(1).max(50_000) });
  const editBody = z.object({ content: z.unknown() });
  const continueBody = z.object({ taskDescription: z.string().trim().min(1).max(50_000), templateId: z.string().optional() });
  if (workflows) {
    app.get("/api/workflows/templates", async () => ({ templates: workflows.templates() }));
    app.get("/api/workflows", async (request) => ({ workflows: workflows.list(owner(request)) }));
    app.post("/api/workflows", async (request, reply) => { const body = workflowBody.parse(request.body); const input = { ...body, ...(owner(request) ? { ownerId: owner(request) } : {}), ...(owner(request) || body.createdBy ? { createdBy: owner(request) ?? body.createdBy } : {}) }; const workflow = body.templateId ? await workflows.create(input) : await workflows.createFromTask(input); return reply.code(201).send({ workflow }); });
    app.get("/api/workflows/:id", async (request) => { const id = workflowIdParams.parse(request.params).id; return { workflow: workflows.get(id, owner(request)) }; });
    app.get("/api/workflows/:id/events", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); return { events: workflows.events(id) }; });
    app.get("/api/workflows/:id/conversation", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); return { messages: workflows.conversation(id) }; });
    app.post("/api/workflows/:id/start", async (request) => { const id = workflowIdParams.parse(request.params).id; return { workflow: await workflows.start(id, owner(request)) }; });
    app.post("/api/workflows/:id/pause", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); return { workflow: await workflows.pause(id) }; });
    app.post("/api/workflows/:id/cancel", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); return { workflow: await workflows.cancel(id) }; });
    app.post("/api/workflows/:id/continue", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); const body = continueBody.parse(request.body); return { workflow: await workflows.continue(id, body.taskDescription, body.templateId) }; });
    app.post("/api/workflows/:id/stages/:stageId/retry", async (request) => { const p = stageParams.parse(request.params); workflows.get(p.id, owner(request)); return { workflow: await workflows.retry(p.id, p.stageId) }; });
    app.get("/api/workflows/:id/history", async (request) => { const id = workflowIdParams.parse(request.params).id; workflows.get(id, owner(request)); return { history: workflows.history(id) }; });
    app.post("/api/workflows/:id/stages/:stageId/approve", async (request) => { const p = stageParams.parse(request.params); workflows.get(p.id, owner(request)); return { workflow: await workflows.approve(p.id, p.stageId) }; });
    app.post("/api/workflows/:id/stages/:stageId/reject", async (request) => { const p = stageParams.parse(request.params); workflows.get(p.id, owner(request)); return { workflow: await workflows.reject(p.id, p.stageId, feedbackBody.parse(request.body).feedback) }; });
    app.post("/api/workflows/:id/stages/:stageId/revise", async (request) => { const p = stageParams.parse(request.params); workflows.get(p.id, owner(request)); return { workflow: await workflows.revise(p.id, p.stageId, revisionBody.parse(request.body).prompt) }; });
    app.post("/api/workflows/:id/stages/:stageId/edit", async (request) => { const p = stageParams.parse(request.params); workflows.get(p.id, owner(request)); return { workflow: await workflows.edit(p.id, p.stageId, editBody.parse(request.body).content) }; });
  }

  app.get("/api/agents", async (request) => ({ agents: service.listAgents(owner(request)) }));

  app.post("/api/agents", async (request, reply) => {
    const body = createAgentBody.parse(request.body);
    const agent = await service.createAgent(body, owner(request));
    return reply.code(201).send({ agent });
  });

  app.get("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: service.getAgent(id, owner(request)) };
  });

  app.patch("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    return { agent: await service.updateAgent(id, body, owner(request)) };
  });

  app.delete("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return service.deleteAgent(id, owner(request));
  });

  app.post("/api/agents/:id/start", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.startAgent(id, owner(request)) };
  });

  app.post("/api/agents/:id/stop", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.stopAgent(id, owner(request)) };
  });

  app.get("/api/agents/:id/messages", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { messages: service.getMessages(id, owner(request)) };
  });

  app.get("/api/agents/:id/runs", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { runs: service.getRuns(id, owner(request)) };
  });

  app.post("/api/agents/:id/messages", async (request, reply) => {
    const { id } = agentIdParams.parse(request.params);
    const body = messageBody.parse(request.body);
    service.getAgent(id, owner(request));
    const result = await service.sendMessage(id, body.content);
    return reply.code(202).send(result);
  });

  app.get("/api/runs/:id", async (request) => {
    const { id } = runIdParams.parse(request.params);
    const run = service.getRun(id);
    service.getAgent(run.agentId, owner(request));
    return { run };
  });

  if (config.nodeEnv === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof Error ? error : new Error(String(error));
    const validationError = error instanceof z.ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : validationError
          ? 400
          : frameworkStatus && frameworkStatus >= 400 && frameworkStatus <= 599
            ? frameworkStatus
            : 500;
    if (statusCode >= 500) {
      request.log.error(appError);
    }
    return reply.code(statusCode).send({
      error: appError.message,
      ...(validationError ? { details: error.issues } : {}),
    });
  });

  return app;
}
