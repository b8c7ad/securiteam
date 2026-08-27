import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import type { JsonStore } from "./store.js";
import { buildPrompt, findPersona, templates, validateSkills, type WorkflowTemplate } from "./workflow-config.js";
import type { Artifact, Database, Stage, Workflow } from "./types.js";

const now = () => new Date().toISOString();
const template = (id: string): WorkflowTemplate => templates.find((item) => item.id === id) ?? templates[0]!;

export class WorkflowService {
  private readonly active = new Map<string, Promise<void>>();
  constructor(private readonly store: JsonStore<Database>, private readonly agents: AgentService) {}

  list(): Workflow[] { return this.store.snapshot().workflows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string): Workflow { const item = this.store.snapshot().workflows.find((value) => value.id === id); if (!item) throw new HttpError(404, "Workflow not found"); return item; }
  events(id: string) { this.get(id); return this.store.snapshot().workflowEvents.filter((event) => event.workflowId === id).sort((a, b) => a.timestamp.localeCompare(b.timestamp)); }
  conversation(id: string) {
    const workflow = this.get(id); const database = this.store.snapshot();
    return database.messages.filter((message) => message.workflowId === id).map((message) => {
      const stage = workflow.stages.find((item) => item.id === message.stageId);
      const agent = database.agents.find((item) => item.id === message.agentId);
      return { ...message, agentName: agent?.name ?? "Unknown Agent", personaId: stage?.personaId ?? null, stageName: stage?.name ?? "Unknown stage", stageOrder: stage?.order ?? null, stageKind: stage?.kind ?? null, stageStatus: stage?.status ?? null };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(input: { taskDescription: string; templateId?: string | undefined; createdBy?: string | undefined }): Promise<Workflow> {
    const selected = template(input.templateId ?? "blog-post-pipeline");
    const id = randomUUID(); const timestamp = now(); const stages: Stage[] = [];
    for (const [index, definition] of selected.stages.entries()) {
      validateSkills(definition.personaId, definition.skillIds ?? []);
      const persona = findPersona(definition.personaId);
      const agent = await this.agents.createAgent({ name: persona.displayName + " · " + (index + 1), description: persona.description, instructions: persona.basePrompt });
      stages.push({ id: randomUUID(), workflowId: id, order: index, name: definition.name, kind: "planned", personaId: definition.personaId, agentId: agent.id, skillIds: definition.skillIds ?? [], verifierIds: definition.verifierIds ?? [], status: "pending", attempt: 0, maxAttempts: 2, createdAt: timestamp, updatedAt: timestamp });
    }
    const workflow: Workflow = { id, taskDescription: input.taskDescription.trim(), stages, status: "draft", createdBy: input.createdBy ?? "local-user", verification: { profile: "balanced", maxAttempts: 2, maxRepairGroups: 5 }, templateId: selected.id, createdAt: timestamp, updatedAt: timestamp };
    await this.store.mutate((database) => database.workflows.push(workflow));
    return workflow;
  }

  async start(id: string): Promise<Workflow> {
    const workflow = this.get(id);
    if (!["draft", "paused"].includes(workflow.status)) throw new HttpError(409, "Workflow cannot be started in its current state");
    await this.store.mutate((database) => { const item = database.workflows.find((value) => value.id === id)!; item.status = "running"; item.updatedAt = now(); });
    if (!this.active.has(id)) { const execution = this.execute(id); this.active.set(id, execution); void execution.finally(() => this.active.delete(id)); }
    return this.get(id);
  }

  private async execute(id: string): Promise<void> {
    for (;;) {
      const workflow = this.get(id); const stage = workflow.stages.find((item) => item.status === "pending");
      if (!stage) { await this.store.mutate((database) => { const item = database.workflows.find((value) => value.id === id)!; if (item.status === "running") item.status = "completed"; item.updatedAt = now(); }); return; }
      const snapshot = this.store.snapshot();
      const repairSource = stage.repairGroupId
        ? snapshot.repairGroups.find((group) => group.id === stage.repairGroupId)?.sourceArtifactId
        : undefined;
      const input = repairSource
        ? snapshot.artifacts.find((item) => item.id === repairSource)?.content
        : stage.order === 0
          ? undefined
          : snapshot.artifacts.find((item) => item.id === workflow.stages[stage.order - 1]?.outputArtifactId)?.content;
      await this.store.mutate((database) => { const item = database.workflows.find((value) => value.id === id)!.stages.find((value) => value.id === stage.id)!; item.status = "running"; item.attempt += 1; item.updatedAt = now(); });
      const current = this.get(id).stages.find((item) => item.id === stage.id)!;
      const run = await this.agents.runToCompletion(current.agentId, buildPrompt(current.personaId, current.skillIds, workflow.taskDescription, input), { workflowId: id, stageId: current.id });
      if (run.status !== "completed" || !run.output) { await this.failStage(id, current.id, run.error ?? "Agent run failed"); return; }
      const artifact: Artifact = { id: randomUUID(), workflowId: id, stageId: current.id, version: 1, format: "text", content: run.output, schemaVersion: 1, metadata: { sourceStageId: current.id }, createdBy: "agent", createdAt: now() };
      await this.store.mutate((database) => { const item = database.workflows.find((value) => value.id === id)!; const stored = item.stages.find((value) => value.id === current.id)!; database.artifacts.push(artifact); database.verificationResults.push({ id: randomUUID(), workflowId: id, stageId: current.id, artifactId: artifact.id, attempt: stored.attempt, hookId: "basic-structure", pass: true, severity: "info", issues: [], createdAt: now() }); stored.outputArtifactId = artifact.id; stored.status = "awaiting_approval"; item.status = "awaiting_approval"; item.updatedAt = now(); database.workflowEvents.push({ id: randomUUID(), workflowId: id, stageId: current.id, agentId: current.agentId, event: "stage_verified", timestamp: now() }); });
      return;
    }
  }

  async approve(workflowId: string, stageId: string): Promise<Workflow> { return this.decide(workflowId, stageId, "approve"); }
  async reject(workflowId: string, stageId: string, feedback: string): Promise<Workflow> { return this.decide(workflowId, stageId, "reject", feedback); }
  async revise(workflowId: string, stageId: string, prompt: string): Promise<Workflow> { return this.decide(workflowId, stageId, "revise", prompt); }
  async edit(workflowId: string, stageId: string, content: unknown): Promise<Workflow> { return this.decide(workflowId, stageId, "edit", JSON.stringify(content)); }
  private async decide(workflowId: string, stageId: string, action: "approve" | "reject" | "revise" | "edit" | "skip", instruction?: string): Promise<Workflow> {
    let repair: { workflow: Workflow; stage: Stage; sourceArtifactId: string } | undefined;
    await this.store.mutate((database) => {
      const workflow = database.workflows.find((item) => item.id === workflowId); const stage = workflow?.stages.find((item) => item.id === stageId);
      if (!workflow || !stage) throw new HttpError(404, "Workflow stage not found");
      if (stage.status !== "awaiting_approval") throw new HttpError(409, "Stage is not awaiting approval");
      if ((action === "reject" || action === "revise") && !instruction?.trim()) throw new HttpError(400, "Feedback or revision prompt is required");
      const artifactId = stage.outputArtifactId!;
      let sourceArtifactId = artifactId;
      if (action === "edit") {
        let content: unknown = instruction;
        try { content = JSON.parse(instruction ?? "null"); } catch { /* retain text */ }
        const edited = { id: randomUUID(), workflowId, stageId, version: 2, parentArtifactId: artifactId, format: "text" as const, content, schemaVersion: 1, metadata: { sourceStageId: stageId }, createdBy: "human" as const, createdAt: now() };
        database.artifacts.push(edited); sourceArtifactId = edited.id;
      }
      database.reviewDecisions.push({ id: randomUUID(), workflowId, stageId, artifactId, action, createdBy: "local-user", createdAt: now(), ...(action === "edit" ? { editedArtifactId: sourceArtifactId } : {}), ...(action === "reject" ? { feedback: instruction } : {}), ...(action === "revise" ? { prompt: instruction } : {}) });
      if (action === "approve" || action === "skip") { stage.status = action === "approve" ? "completed" : "skipped"; workflow.status = "running"; }
      else { stage.status = "rejected"; workflow.status = "paused"; repair = { workflow: structuredClone(workflow), stage: structuredClone(stage), sourceArtifactId }; }
      workflow.updatedAt = now(); database.workflowEvents.push({ id: randomUUID(), workflowId, stageId, event: "human_" + action, details: instruction ? { instruction } : undefined, timestamp: now() });
    });
    if (repair) await this.createRepair(workflowId, repair.stage, repair.sourceArtifactId, action === "edit" ? "human_edit" : action === "reject" ? "human_rejection" : "human_prompt", instruction);
    if (!this.active.has(workflowId)) { const execution = this.execute(workflowId); this.active.set(workflowId, execution); void execution.finally(() => this.active.delete(workflowId)); }
    return this.get(workflowId);
  }
  private async createRepair(workflowId: string, source: Stage, sourceArtifactId: string, trigger: "human_edit" | "human_rejection" | "human_prompt", instruction?: string): Promise<void> {
    const workflow = this.get(workflowId); const db = this.store.snapshot();
    if (db.repairGroups.filter((item) => item.workflowId === workflowId).length >= workflow.verification.maxRepairGroups) throw new HttpError(409, "Repair limit reached");
    const groupId = randomUUID(); const created: Stage[] = [];
    for (const [index, personaId] of ["drafter", "editor", "reviewer"].entries()) {
      const persona = findPersona(personaId); const agent = await this.agents.createAgent({ name: "Repair " + persona.displayName, description: persona.description, instructions: persona.basePrompt }); const timestamp = now();
      created.push({ id: randomUUID(), workflowId, order: source.order + index + 1, name: "Repair " + persona.displayName, kind: "repair", repairGroupId: groupId, insertedAfterStageId: source.id, personaId, agentId: agent.id, skillIds: [], verifierIds: [], status: "pending", attempt: 0, maxAttempts: workflow.verification.maxAttempts, createdAt: timestamp, updatedAt: timestamp });
    }
    await this.store.mutate((database) => { const item = database.workflows.find((value) => value.id === workflowId)!; const position = item.stages.findIndex((stage) => stage.id === source.id); item.stages.splice(position + 1, 0, ...created); item.stages = item.stages.map((stage, index) => ({ ...stage, order: index })); database.repairGroups.push({ id: groupId, workflowId, sourceStageId: source.id, sourceArtifactId, trigger, ...(trigger === "human_rejection" ? { feedback: instruction } : {}), ...(trigger === "human_prompt" ? { prompt: instruction } : {}), stageIds: created.map((stage) => stage.id), status: "pending", createdAt: now() }); });
  }
  private async failStage(workflowId: string, stageId: string, error: string): Promise<void> { await this.store.mutate((database) => { const workflow = database.workflows.find((item) => item.id === workflowId)!; const stage = workflow.stages.find((item) => item.id === stageId)!; stage.status = "failed"; stage.lastError = error; workflow.status = "failed"; workflow.updatedAt = now(); }); }
}
