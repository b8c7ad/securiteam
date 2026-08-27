export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type AgentVisibility = "standalone" | "internal";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowStatus = "draft" | "running" | "paused" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type StageStatus = "pending" | "running" | "awaiting_approval" | "approved" | "rejected" | "completed" | "skipped" | "failed";
export type VerificationProfile = "thorough" | "balanced" | "token_saver";

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
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  createdAt: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
}

export interface WorkflowStage {
  id: string;
  workflowId: string;
  order: number;
  name: string;
  kind: "planned" | "repair";
  repairGroupId?: string;
  personaId: string;
  agentId: string;
  status: StageStatus;
  outputArtifactId?: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string;
  taskDescription?: string;
  iteration?: number;
}

export interface Workflow {
  id: string;
  taskDescription: string;
  stages: WorkflowStage[];
  status: WorkflowStatus;
  verification: { profile: VerificationProfile; maxAttempts: number; maxRepairGroups: number };
  templateId?: string;
  createdAt: string;
  updatedAt: string;
  iteration?: number;
}
export interface WorkflowTemplate { id: string; displayName: string; description: string; stages: Array<{ name: string; personaId: string }> }

export interface WorkflowMessage extends Message {
  agentName: string;
  personaId: string | null;
  stageName: string;
  stageOrder: number | null;
  stageKind: "planned" | "repair" | null;
  stageStatus: StageStatus | null;
}

export interface WorkflowEvent {
  id: string;
  workflowId: string;
  stageId?: string;
  event: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
