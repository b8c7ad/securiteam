import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isArkConfigured } from "./config.js";
import { HttpError, RunCancelledError } from "./errors.js";
import { JsonStore } from "./store.js";
import type {
  Agent,
  AgentRun,
  AgentRunner,
  CreateAgentInput,
  Message,
  UpdateAgentInput,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";
import path from "node:path";

const now = () => new Date().toISOString();

export class AgentService {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    await this.store.mutate((database) => {
      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.completedAt = now();
        }
      }
      for (const agent of database.agents) {
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.updatedAt = now();
        }
      }
    });
  }

  listAgents(): Agent[] {
    return this.store
      .snapshot()
      .agents.filter((agent) => agent.visibility !== "internal")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getAgent(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  async describeWorkspace(agentId: string, maxChars?: number): Promise<string> {
    return this.workspaces.describe(this.getAgent(agentId).workspacePath, maxChars);
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const agent: Agent = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions: input.instructions?.trim() ?? "",
      status: "ready",
      visibility: input.visibility ?? "standalone",
      workspacePath: input.workspacePath ?? this.workspaces.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.workspaces.create(agent);
    await this.store.mutate((database) => database.agents.push(agent));
    return agent;
  }

  async createWorkflowAgent(workflowId: string, input: Omit<CreateAgentInput, "visibility" | "workspacePath">): Promise<Agent> {
    return this.createAgent({ ...input, visibility: "internal", workspacePath: path.join(this.config.workspaceRoot, "workflows", workflowId) });
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.getAgent(id);
    if (current.status === "busy") {
      throw new HttpError(409, "Stop the active run before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before editing this Agent");
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) agent.instructions = input.instructions.trim();
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    await this.workspaces.writeInstructions(updated);
    return updated;
  }

  async deleteAgent(id: string): Promise<{ archivedWorkspace: string }> {
    const agent = this.getAgent(id);
    await this.cancelExecution(id);
    const archivedWorkspace = await this.workspaces.archive(agent);
    await this.store.mutate((database) => {
      database.agents = database.agents.filter((item) => item.id !== id);
      database.messages = database.messages.filter((item) => item.agentId !== id);
      database.runs = database.runs.filter((item) => item.agentId !== id);
    });
    return { archivedWorkspace };
  }

  async startAgent(id: string): Promise<Agent> {
    return this.setStatus(id, "ready");
  }

  async stopAgent(id: string): Promise<Agent> {
    this.getAgent(id);
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped");
  }

  getMessages(agentId: string): Message[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getRun(runId: string): AgentRun {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return run;
  }

  getRuns(agentId: string): AgentRun[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async sendMessage(
    agentId: string,
    prompt: string,
    metadata?: { workflowId?: string; stageId?: string; displayContent?: string; workflowDisplay?: boolean; readOnly?: boolean },
  ): Promise<{ run: AgentRun; message: Message }> {
    if (!isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    const timestamp = now();
    const runId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      ...(metadata?.workflowId ? { workflowId: metadata.workflowId } : {}),
      ...(metadata?.stageId ? { stageId: metadata.stageId } : {}),
    };
    const message: Message = {
      id: randomUUID(),
      agentId,
      runId,
      role: "user",
      content: metadata?.displayContent ?? prompt,
      createdAt: timestamp,
      ...(metadata?.workflowId ? { workflowId: metadata.workflowId } : {}),
      ...(metadata?.stageId ? { stageId: metadata.stageId } : {}),
      ...(metadata?.workflowDisplay !== undefined ? { workflowDisplay: metadata.workflowDisplay } : {}),
    };
    const agentAtStart = await this.store.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      database.runs.push(run);
      database.messages.push(message);
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    const execution = this.executeRun(agentAtStart, run);
    this.activeExecutions.set(agentId, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentId) === execution) {
          this.activeExecutions.delete(agentId);
        }
      })
      .catch(() => undefined);
    return { run, message };
  }

  async runToCompletion(agentId: string, prompt: string, metadata?: { workflowId?: string; stageId?: string; readOnly?: boolean }): Promise<AgentRun> {
    const result = await this.sendMessage(agentId, prompt, metadata);
    for (;;) {
      const run = this.getRun(result.run.id);
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async runDirectToCompletion(agentId: string, prompt: string, maxTokens: number, metadata?: { workflowId?: string; stageId?: string }): Promise<AgentRun> {
    if (!isArkConfigured(this.config)) throw new HttpError(503, "Ark is not configured.");
    const timestamp = now(); const runId = randomUUID();
    const run: AgentRun = { id: runId, agentId, status: "running", prompt, output: null, error: null, usage: null, startedAt: timestamp, completedAt: null, createdAt: timestamp, ...(metadata?.workflowId ? { workflowId: metadata.workflowId } : {}), ...(metadata?.stageId ? { stageId: metadata.stageId } : {}) };
    const message: Message = { id: randomUUID(), agentId, runId, role: "user", content: prompt, createdAt: timestamp, ...(metadata?.workflowId ? { workflowId: metadata.workflowId } : {}), ...(metadata?.stageId ? { stageId: metadata.stageId } : {}) };
    await this.store.mutate((db) => { const agent = db.agents.find((item) => item.id === agentId); if (!agent) throw new HttpError(404, "Agent not found"); if (agent.status === "busy") throw new HttpError(409, "This Agent is already running"); agent.status = "busy"; db.runs.push(run); db.messages.push(message); });
    try {
      const response = await fetch(this.config.arkBaseUrl + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + this.config.arkApiKey }, body: JSON.stringify({ model: this.config.arkModel, temperature: 0, max_tokens: Math.min(Math.max(1, maxTokens), 200_000), messages: [{ role: "user", content: prompt }] }) });
      if (!response.ok) throw new Error("Ark stage returned HTTP " + response.status);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const output = body.choices?.[0]?.message?.content?.trim(); if (!output) throw new Error("Ark stage returned no content");
      const completedAt = now(); await this.store.mutate((db) => { const stored = db.runs.find((item) => item.id === runId)!; const agent = db.agents.find((item) => item.id === agentId)!; stored.status = "completed"; stored.output = output; stored.completedAt = completedAt; db.messages.push({ id: randomUUID(), agentId, runId, role: "assistant", content: output, createdAt: completedAt, ...(metadata?.workflowId ? { workflowId: metadata.workflowId } : {}), ...(metadata?.stageId ? { stageId: metadata.stageId } : {}) }); agent.status = "ready"; agent.lastError = null; agent.updatedAt = completedAt; });
    } catch (error) { const completedAt = now(); const messageText = error instanceof Error ? error.message : String(error); await this.store.mutate((db) => { const stored = db.runs.find((item) => item.id === runId); const agent = db.agents.find((item) => item.id === agentId); if (stored) { stored.status = "failed"; stored.error = messageText; stored.completedAt = completedAt; } if (agent) { agent.status = "error"; agent.lastError = messageText; agent.updatedAt = completedAt; } }); }
    return this.getRun(runId);
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
    };
  }

  private async executeRun(agentAtStart: Agent, run: AgentRun): Promise<void> {
    await this.store.mutate((database) => {
      const storedRun = database.runs.find((item) => item.id === run.id);
      if (storedRun) {
        storedRun.status = "running";
        storedRun.startedAt = now();
      }
    });
    try {
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }
      const readOnlyWorkflowAnalysis = Boolean(
        run.workflowId && run.stageId &&
        this.store.snapshot().workflows
          .find((workflow) => workflow.id === run.workflowId)?.stages
          .find((stage) => stage.id === run.stageId)?.personaId === "analyzer" &&
        run.prompt.includes("Analyzer constraint: inspect the workspace in read-only mode"),
      );
      const workflowPersona = run.workflowId && run.stageId
        ? this.store.snapshot().workflows.find((workflow) => workflow.id === run.workflowId)?.stages.find((stage) => stage.id === run.stageId)?.personaId
        : undefined;
      const reasoningEffort = workflowPersona === "brainstormer" || workflowPersona === "analyzer"
        ? "low" : workflowPersona === "tester" ? "medium" : undefined;
      const maxOutputBytes = workflowPersona === "tester" ? 512 * 1024 : workflowPersona === "analyzer" ? 768 * 1024 : undefined;
      const timeoutMs = workflowPersona === "tester" ? 240_000 : undefined;
      const result = await this.runner.run({
        agentId: agentAtStart.id,
        workspacePath: agentAtStart.workspacePath,
        prompt: run.prompt,
        // New workflow agents start fresh; continuation stages reuse matching
        // agents and therefore resume their existing Codex conversation.
        threadId: agentAtStart.codexThreadId,
        ...(readOnlyWorkflowAnalysis ? { sandboxMode: "read-only" as const } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(maxOutputBytes ? { maxOutputBytes } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      const completedAt = now();
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (!storedRun || !agent) return;
        storedRun.status = "completed";
        storedRun.output = result.output;
        storedRun.usage = result.usage;
        storedRun.completedAt = completedAt;
        database.messages.push({
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: result.output,
          createdAt: completedAt,
          ...(storedRun.workflowId ? { workflowId: storedRun.workflowId } : {}),
          ...(storedRun.stageId ? { stageId: storedRun.stageId } : {}),
        });
        agent.status = "ready";
        agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
      });
    } catch (error) {
      const completedAt = now();
      const cancelled = error instanceof RunCancelledError;
      const message = error instanceof Error ? error.message : String(error);
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (storedRun) {
          storedRun.status = cancelled ? "cancelled" : "failed";
          storedRun.error = message;
          storedRun.completedAt = completedAt;
        }
        if (agent) {
          if (agent.status !== "stopped") {
            agent.status = cancelled ? "ready" : "error";
          }
          agent.lastError = cancelled ? null : message;
          agent.updatedAt = completedAt;
        }
      });
    }
  }

  private async setStatus(id: string, status: Agent["status"]): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (status === "ready" && agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
