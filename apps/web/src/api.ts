import type { Agent, AgentRun, Message, SystemInfo, VerificationProfile, Workflow, WorkflowEvent, WorkflowMessage, WorkflowTemplate } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";
let credentials: { username: string; password: string } | null = null;

export function setAuthToken(token: string): void {
  authToken = token.trim();
}
export function setCredentials(next: { username: string; password: string } | null): void {
  credentials = next;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...(credentials ? {
      "X-Launchpad-Username": credentials.username,
      "X-Launchpad-Password": credentials.password,
    } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  login: (username: string, password: string, honeypot = "") => request<{ user: { username: string; isContributor: boolean } }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, honeypot }) }),
  register: (username: string, password: string, securityKey: string) => request<{ user: { username: string; isContributor: boolean } }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, securityKey }) }),
  resetPassword: (username: string, securityKey: string, password: string) => request<{ ok: true }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ username, securityKey, password }) }),
  changePassword: (password: string) => request<{ ok: true }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ password }) }),
  me: () => request<{ user: { username: string; isContributor: boolean } }>("/api/auth/me"),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  preferences: () => request<{ preferences: { theme: string; font: string } }>("/api/auth/preferences"),
  savePreferences: (theme: string, font: string) => request<{ preferences: { theme: string; font: string } }>("/api/auth/preferences", { method: "PATCH", body: JSON.stringify({ theme, font }) }),
  auth: () => request<{ required: boolean }>("/api/auth"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),
  workflows: () => request<{ workflows: Workflow[] }>("/api/workflows"),
  workflowTemplates: () => request<{ templates: WorkflowTemplate[] }>("/api/workflows/templates"),
  createWorkflow: (taskDescription: string, verificationProfile: VerificationProfile, templateId?: string) => request<{ workflow: Workflow }>("/api/workflows", { method: "POST", body: JSON.stringify({ taskDescription, verificationProfile, ...(templateId ? { templateId } : {}) }) }),
  workflow: (id: string) => request<{ workflow: Workflow }>("/api/workflows/" + id),
  workflowConversation: (id: string) => request<{ messages: WorkflowMessage[] }>("/api/workflows/" + id + "/conversation"),
  workflowEvents: (id: string) => request<{ events: WorkflowEvent[] }>("/api/workflows/" + id + "/events"),
  startWorkflow: (id: string) => request<{ workflow: Workflow }>("/api/workflows/" + id + "/start", { method: "POST" }),
  pauseWorkflow: (id: string) => request<{ workflow: Workflow }>("/api/workflows/" + id + "/pause", { method: "POST" }),
  cancelWorkflow: (id: string) => request<{ workflow: Workflow }>("/api/workflows/" + id + "/cancel", { method: "POST" }),
  continueWorkflow: (id: string, taskDescription: string, templateId?: string) => request<{ workflow: Workflow }>(`/api/workflows/${id}/continue`, { method: "POST", body: JSON.stringify({ taskDescription, ...(templateId ? { templateId } : {}) }) }),
  retryStage: (workflowId: string, stageId: string) => request<{ workflow: Workflow }>(`/api/workflows/${workflowId}/stages/${stageId}/retry`, { method: "POST" }),
  approveStage: (workflowId: string, stageId: string) => request<{ workflow: Workflow }>(`/api/workflows/${workflowId}/stages/${stageId}/approve`, { method: "POST" }),
  rejectStage: (workflowId: string, stageId: string, feedback: string) => request<{ workflow: Workflow }>(`/api/workflows/${workflowId}/stages/${stageId}/reject`, { method: "POST", body: JSON.stringify({ feedback }) }),
  reviseStage: (workflowId: string, stageId: string, prompt: string) => request<{ workflow: Workflow }>(`/api/workflows/${workflowId}/stages/${stageId}/revise`, { method: "POST", body: JSON.stringify({ prompt }) }),
  editStage: (workflowId: string, stageId: string, content: string) => request<{ workflow: Workflow }>(`/api/workflows/${workflowId}/stages/${stageId}/edit`, { method: "POST", body: JSON.stringify({ content }) }),
};
