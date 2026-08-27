import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkflowService } from "./workflow-service.js";
import { WorkspaceManager } from "./workspace.js";

class FakeRunner implements AgentRunner { async run(request: RunnerRequest): Promise<RunnerResult> { return { output: "output for " + request.prompt.slice(0, 8), threadId: "thread", usage: null }; } async cancel() { return false; } async isAvailable() { return true; } }
const roots: string[] = [];
afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("WorkflowService", () => {
  it("runs stages, verifies outputs, and resumes after approval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize();
    const workflows = new WorkflowService(store, agents); const workflow = await workflows.create({ taskDescription: "write a summary" }); await workflows.start(workflow.id);
    await expect.poll(() => workflows.get(workflow.id).stages[0]?.status).toBe("awaiting_approval");
    expect(workflows.get(workflow.id).status).toBe("awaiting_approval"); expect(store.snapshot().verificationResults.length).toBeGreaterThan(0); expect(store.snapshot().verificationResults.every((result) => result.pass)).toBe(true);
    await workflows.approve(workflow.id, workflows.get(workflow.id).stages[0]!.id);
    await expect(workflows.approve(workflow.id, workflows.get(workflow.id).stages[0]!.id)).resolves.toBeTruthy();
    await expect.poll(() => workflows.get(workflow.id).stages[1]?.status).toBe("awaiting_approval");
    expect(workflows.conversation(workflow.id).every((message) => message.agentName && message.stageId)).toBe(true);
  });

  it("reuses the producing worker for a revision prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-repair-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize(); const workflows = new WorkflowService(store, agents);
    const workflow = await workflows.create({ taskDescription: "draft" }); await workflows.start(workflow.id); await expect.poll(() => workflows.get(workflow.id).stages[0]?.status).toBe("awaiting_approval");
    const stage = workflows.get(workflow.id).stages[0]!; const workerId = stage.agentId;
    await workflows.revise(workflow.id, stage.id, "make it shorter"); const updated = workflows.get(workflow.id);
    expect(updated.stages.filter((item) => item.kind === "repair")).toHaveLength(0);
    expect(updated.stages[0]?.agentId).toBe(workerId);
    expect(store.snapshot().agents).toHaveLength(updated.stages.length);
    expect(agents.listAgents()).toHaveLength(0);
    expect(store.snapshot().workflowEvents.some((event) => event.event === "human_revise")).toBe(true);
  });

  it("recovers running workflows as paused", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-recovery-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex") });
    const store = new JsonStore(path.join(root, "data", "db.json")); await store.initialize();
    await store.mutate((db) => db.workflows.push({ id: "00000000-0000-4000-8000-000000000001", taskDescription: "x", stages: [], status: "running", createdBy: "test", verification: { profile: "balanced", maxAttempts: 2, maxRepairGroups: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize(); const workflows = new WorkflowService(store, agents); await workflows.initialize();
    expect(workflows.get("00000000-0000-4000-8000-000000000001").status).toBe("paused"); expect(workflows.events("00000000-0000-4000-8000-000000000001").some((event) => event.event === "workflow_recovered")).toBe(true);
  });
});
