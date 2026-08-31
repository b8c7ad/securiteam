import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("uses distinct greenfield and existing-code pipelines with bounded Tester attempts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-template-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize(); const workflows = new WorkflowService(store, agents);
    const greenfield = await workflows.create({ taskDescription: "build an app", templateId: "software-build-pipeline" });
    const existing = await workflows.create({ taskDescription: "fix an app", templateId: "bug-fix-pipeline" });
    expect(greenfield.stages.map((stage) => stage.personaId)).toEqual(["brainstormer", "developer", "tester", "reviewer"]);
    expect(existing.stages.map((stage) => stage.personaId)).toEqual(["analyzer", "developer", "tester", "reviewer"]);
    expect(greenfield.stages.find((stage) => stage.personaId === "tester")?.maxAttempts).toBe(1);
    expect(existing.stages.find((stage) => stage.personaId === "tester")?.maxAttempts).toBe(1);
    expect(greenfield.verification.profile).toBe("token_saver");
  });

  it("stores full output but passes a smaller handoff to the next stage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-handoff-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const output = "A".repeat(20_000);
    const runner: AgentRunner = { run: async () => ({ output, threadId: "thread", usage: null }), cancel: async () => false, isAvailable: async () => true };
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), runner); await agents.initialize(); const workflows = new WorkflowService(store, agents, config);
    const workflow = await workflows.create({ taskDescription: "draft", templateId: "blog-post-pipeline" }); await workflows.start(workflow.id);
    await expect.poll(() => store.snapshot().artifacts.length).toBe(1);
    const artifact = store.snapshot().artifacts[0]!;
    expect(String(artifact.content)).toHaveLength(20_000);
    expect(artifact.handoffContent?.length).toBeLessThan(20_000);
  });

  it("skips external Ark verification in token saver workflows", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const root = await mkdtemp(path.join(tmpdir(), "workflow-token-saver-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize(); const workflows = new WorkflowService(store, agents, config);
    const workflow = await workflows.create({ taskDescription: "build an app", templateId: "software-build-pipeline" }); await workflows.start(workflow.id);
    await expect.poll(() => workflows.get(workflow.id).stages[0]?.status).toBe("awaiting_approval");
    expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
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
