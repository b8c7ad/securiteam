export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type AgentVisibility = "standalone" | "internal";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";
export type WorkflowStatus = "draft" | "running" | "paused" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type StageStatus = "pending" | "running" | "awaiting_approval" | "approved" | "rejected" | "completed" | "skipped" | "failed";
export type StageKind = "planned" | "repair";
export type VerificationProfile = "thorough" | "balanced" | "token_saver";
export type StageExecutionMode = "direct-ark" | "codex";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  visibility: AgentVisibility;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  workflowId?: string;
  stageId?: string;
  workflowDisplay?: boolean;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: RunUsage | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  workflowId?: string;
  stageId?: string;
}

export interface Database {
  version: 2;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
  users: User[];
  workflows: Workflow[];
  artifacts: Artifact[];
  repairGroups: RepairGroup[];
  reviewDecisions: ReviewDecision[];
  verificationResults: VerificationResultRecord[];
  workflowEvents: WorkflowEvent[];
}

export interface VerificationSettings { profile: VerificationProfile; maxAttempts: number; maxRepairGroups: number; }
export interface Workflow { id: string; taskDescription: string; stages: Stage[]; status: WorkflowStatus; createdBy: string; verification: VerificationSettings; templateId?: string; iteration?: number; createdAt: string; updatedAt: string; }
export interface Stage { id: string; workflowId: string; order: number; name: string; kind: StageKind; repairGroupId?: string; insertedAfterStageId?: string; personaId: string; agentId: string; skillIds: string[]; verifierIds: string[]; executionMode?: StageExecutionMode; userFlair?: string; revisionPrompt?: string; taskDescription?: string; iteration?: number; status: StageStatus; inputArtifactId?: string; outputArtifactId?: string; attempt: number; maxAttempts: number; lastError?: string; createdAt: string; updatedAt: string; }
export interface Artifact { id: string; workflowId: string; stageId: string; version: number; parentArtifactId?: string; format: "text" | "markdown" | "json" | "code"; content: unknown; schemaVersion: number; confidence?: number; flaggedForReview?: boolean; rationale?: string; metadata: Record<string, unknown>; createdBy: "agent" | "verifier" | "human"; createdAt: string; }
export type HumanReviewAction = "approve" | "edit" | "reject" | "revise" | "skip";
export interface ReviewDecision { id: string; workflowId: string; stageId: string; artifactId: string; action: HumanReviewAction; feedback?: string | undefined; prompt?: string | undefined; editedArtifactId?: string | undefined; createdBy: string; createdAt: string; }
export interface RepairGroup { id: string; workflowId: string; sourceStageId: string; sourceArtifactId: string; trigger: "human_edit" | "human_rejection" | "human_prompt"; feedback?: string | undefined; prompt?: string | undefined; stageIds: string[]; status: "pending" | "running" | "completed" | "failed"; createdAt: string; completedAt?: string | undefined; }
export interface VerificationResultRecord { id: string; workflowId: string; stageId: string; artifactId: string; attempt: number; hookId: string; pass: boolean; severity: "info" | "warn" | "block"; issues: string[]; suggestedFix?: string; createdAt: string; }
export interface WorkflowEvent { id: string; workflowId: string; stageId?: string | undefined; repairGroupId?: string | undefined; agentId?: string | undefined; event: string; details?: Record<string, unknown> | undefined; timestamp: string; }

export type Theme = "system" | "light" | "dark" | "sepia" | "forest" | "ocean";
export type AppFont = "system" | "serif" | "dyslexia" | "modern";
export interface UserPreference { username: string; theme: Theme; font: AppFont; updatedAt: string; }
export interface PreferencesDatabase { version: 1; preferences: UserPreference[]; }

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  isContributor: boolean;
}

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  visibility?: AgentVisibility | undefined;
  workspacePath?: string | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface RunnerRequest {
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface AgentRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}
