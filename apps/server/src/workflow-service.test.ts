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
    expect(workflows.get(workflow.id).status).toBe("awaiting_approval"); expect(store.snapshot().verificationResults).toHaveLength(1);
    await workflows.approve(workflow.id, workflows.get(workflow.id).stages[0]!.id);
    await expect.poll(() => workflows.get(workflow.id).stages[1]?.status).toBe("awaiting_approval");
    expect(workflows.conversation(workflow.id).every((message) => message.agentName && message.stageId)).toBe(true);
  });

  it("inserts repair stages for a revision prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-repair-test-")); roots.push(root);
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.join(root, "data"), AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"), CODEX_HOME: path.join(root, "codex"), ARK_API_KEY: "key", ARK_MODEL: "model" });
    const store = new JsonStore(path.join(root, "data", "db.json")); const agents = new AgentService(config, store, new WorkspaceManager(config.workspaceRoot), new FakeRunner()); await agents.initialize(); const workflows = new WorkflowService(store, agents);
    const workflow = await workflows.create({ taskDescription: "draft" }); await workflows.start(workflow.id); await expect.poll(() => workflows.get(workflow.id).stages[0]?.status).toBe("awaiting_approval");
    await workflows.revise(workflow.id, workflows.get(workflow.id).stages[0]!.id, "make it shorter"); const updated = workflows.get(workflow.id);
    expect(updated.stages.filter((stage) => stage.kind === "repair")).toHaveLength(3); expect(store.snapshot().repairGroups[0]?.trigger).toBe("human_prompt");
  });
});
