import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, setAuthToken, setCredentials } from "./api";
import type {
  Agent,
  AgentRun,
  Message,
  SystemInfo,
  VerificationProfile,
  Workflow,
  WorkflowEvent,
  WorkflowMessage,
  WorkflowTemplate,
} from "./types";

const starterPrompts = [
  "Create a small TypeScript CLI that prints a weather summary from sample JSON.",
  "Inspect this workspace and explain what you would improve first.",
  "Build a responsive single-page todo app with tests.",
];

const emptyForm = {
  name: "",
  description: "",
  instructions:
    "Help me build and test software in this workspace. Keep changes small and explain the result.",
};

type Theme = "system" | "light" | "dark" | "sepia" | "forest" | "ocean";
type AppFont = "system" | "serif" | "dyslexia" | "modern";

const themeOptions: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia" },
  { value: "forest", label: "Forest" },
  { value: "ocean", label: "Ocean" },
];
const fontOptions: Array<{ value: AppFont; label: string; sample: string }> = [
  { value: "system", label: "System UI", sample: "Aa" },
  { value: "serif", label: "Georgia", sample: "Aa" },
  { value: "dyslexia", label: "Verdana", sample: "Aa" },
  { value: "modern", label: "Inter", sample: "Aa" },
];

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function StatusPill({ status }: { status: Agent["status"] }) {
  return (
    <span className={"status status-" + status}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

const verificationOptions: Array<{
  value: VerificationProfile;
  label: string;
  help: string;
}> = [
  {
    value: "thorough",
    label: "Thorough",
    help: "More immediate checking · highest token use",
  },
  { value: "balanced", label: "Balanced", help: "Good coverage · recommended" },
  {
    value: "token_saver",
    label: "Minimal",
    help: "Lightweight checking · lowest token use",
  },
];

function identityColour(id: string): string {
  const colours = ["violet", "teal", "amber", "rose", "blue", "green"];
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colours[hash % colours.length]!;
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [workflowMessages, setWorkflowMessages] = useState<WorkflowMessage[]>(
    [],
  );
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [showWorkflowCreate, setShowWorkflowCreate] = useState(false);
  const [workflowTask, setWorkflowTask] = useState("");
  const [workflowTemplates, setWorkflowTemplates] = useState<
    WorkflowTemplate[]
  >([]);
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [verificationProfile, setVerificationProfile] =
    useState<VerificationProfile>("balanced");
  const [reviewInput, setReviewInput] = useState("");
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [prompt, setPrompt] = useState("");
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recover">("login");
  const [securityKey, setSecurityKey] = useState("");
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showRegistrationPassword, setShowRegistrationPassword] = useState(false);
  const [showSecurityKey, setShowSecurityKey] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"password" | "preferences">(
    "password",
  );
  const [theme, setTheme] = useState<Theme>("system");
  const [appFont, setAppFont] = useState<AppFont>("system");
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const messageEnd = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const pollingRunIds = useRef(new Set<string>());
  selectedIdRef.current = selectedId;

  const clearWorkspaceState = useCallback(() => {
    setAgents([]);
    setSelectedId(null);
    setMessages([]);
    setWorkflows([]);
    setSelectedWorkflowId(null);
    setWorkflowMessages([]);
    setWorkflowEvents([]);
    setActiveRun(null);
    setError(null);
    setShowSettings(false);
    setShowProfile(false);
  }, []);

  useEffect(() => {
    // Authentication always uses the browser's system appearance and font;
    // restore the saved workspace preferences once the user is signed in.
    const authenticated = authRequired === false;
    document.documentElement.dataset.theme = authenticated ? theme : "system";
    document.documentElement.dataset.font = authenticated ? appFont : "system";
  }, [appFont, authRequired, theme]);

  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const selectedWorkflow = useMemo(
    () =>
      workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  );

  const refreshAgents = useCallback(async () => {
    const { agents: next } = await api.listAgents();
    setAgents(next);
    setSelectedId((current) =>
      current && next.some((agent) => agent.id === current)
        ? current
        : (next[0]?.id ?? null),
    );
  }, []);

  const refreshMessages = useCallback(async (agentId: string) => {
    const result = await api.messages(agentId);
    if (mountedRef.current && selectedIdRef.current === agentId) {
      setMessages(result.messages);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    await Promise.all([
      refreshAgents(),
      api.system().then(setSystem),
      api.workflows().then(({ workflows: next }) => setWorkflows(next)),
      api
        .workflowTemplates()
        .then(({ templates: next }) => setWorkflowTemplates(next)),
    ]);
  }, [refreshAgents]);

  const refreshWorkflow = useCallback(
    async (workflowId: string) => {
      const [workflowResult, conversationResult, eventsResult] =
        await Promise.all([
          api.workflow(workflowId),
          api.workflowConversation(workflowId),
          api.workflowEvents(workflowId),
        ]);
      if (mountedRef.current && selectedWorkflowId === workflowId) {
        setWorkflows((current) =>
          current.map((item) =>
            item.id === workflowId ? workflowResult.workflow : item,
          ),
        );
        setWorkflowMessages(conversationResult.messages);
        setWorkflowEvents(eventsResult.events);
      }
      return workflowResult.workflow;
    },
    [selectedWorkflowId],
  );

  useEffect(() => {
    if (!selectedWorkflowId) {
      setWorkflowMessages([]);
      return;
    }
    void refreshWorkflow(selectedWorkflowId).catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [refreshWorkflow, selectedWorkflowId]);

  useEffect(() => {
    if (
      !selectedWorkflow ||
      !["running", "awaiting_approval"].includes(selectedWorkflow.status)
    )
      return;
    let stopped = false;
    const poll = async () => {
      if (stopped || !selectedWorkflowId) return;
      try {
        const workflow = await refreshWorkflow(selectedWorkflowId);
        if (
          !stopped &&
          ["running", "awaiting_approval"].includes(workflow.status)
        )
          window.setTimeout(() => void poll(), 1000);
      } catch (reason) {
        if (!stopped)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    const timer = window.setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refreshWorkflow, selectedWorkflow, selectedWorkflowId]);

  useEffect(() => {
    mountedRef.current = true;
    void api
      .auth()
      .then(async ({ required }) => {
        if (!mountedRef.current) return;
        if (required) {
          setAuthRequired(true);
          return;
        }
        const { user: current } = await api.me();
        if (!mountedRef.current) return;
        const preferences = await api.preferences();
        setTheme(preferences.preferences.theme as Theme);
        setAppFont(preferences.preferences.font as AppFont);
        setUser(current);
        setAuthRequired(false);
        await bootstrap();
      })
      .catch(() => setAuthRequired(true));
    return () => {
      mountedRef.current = false;
    };
  }, [bootstrap]);

  useEffect(() => {
    setActiveRun(null);
    setShowSettings(false);
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void Promise.all([refreshMessages(selectedId), api.runs(selectedId)])
      .then(([, result]) => {
        if (selectedIdRef.current !== selectedId) return;
        const latest = result.runs[0] ?? null;
        setActiveRun(latest);
        if (latest && ["queued", "running"].includes(latest.status)) {
          void pollRun(latest.id, selectedId).catch((reason) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        }
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [refreshMessages, selectedId]);

  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name,
        description: selected.description,
        instructions: selected.instructions,
      });
    }
  }, [selected]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeRun]);

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { agent } = await api.createAgent(form);
      await refreshAgents();
      setSelectedId(agent.id);
      setShowCreate(false);
      setForm(emptyForm);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateAgent(selected.id, form);
      await refreshAgents();
      setShowSettings(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleAgent = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (selected.status === "stopped") {
        await api.startAgent(selected.id);
      } else {
        await api.stopAgent(selected.id);
      }
      await refreshAgents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async () => {
    if (!selected) return;
    if (
      !window.confirm(
        "Delete " + selected.name + "? Its workspace will be archived.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgent(selected.id);
      await refreshAgents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const pollRun = async (runId: string, agentId: string) => {
    if (pollingRunIds.current.has(runId)) return;
    pollingRunIds.current.add(runId);
    try {
      while (mountedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (!mountedRef.current) return;
        const result = await api.run(runId);
        if (selectedIdRef.current === agentId) setActiveRun(result.run);
        if (!["queued", "running"].includes(result.run.status)) {
          await Promise.all([refreshMessages(agentId), refreshAgents()]);
          return;
        }
      }
    } finally {
      pollingRunIds.current.delete(runId);
    }
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !prompt.trim()) return;
    const content = prompt.trim();
    setPrompt("");
    setError(null);
    try {
      const result = await api.sendMessage(selected.id, content);
      if (selectedIdRef.current === selected.id) {
        setMessages((current) => [...current, result.message]);
        setActiveRun(result.run);
      }
      setAgents((current) =>
        current.map((agent) =>
          agent.id === selected.id ? { ...agent, status: "busy" } : agent,
        ),
      );
      await pollRun(result.run.id, selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setActiveRun(null);
      await refreshAgents();
    }
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(username, password, honeypot);
      setCredentials({ username, password });
      clearWorkspaceState();
      const preferences = await api.preferences();
      setTheme(preferences.preferences.theme as Theme);
      setAppFont(preferences.preferences.font as AppFont);
      setUser(result.user);
      await bootstrap();
      setAuthRequired(false);
      setAuthMode("login");
      setUsername("");
      setPassword("");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setError("Invalid username or password.");
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.register(username, registerPassword, securityKey);
      setCredentials({ username, password: registerPassword });
      clearWorkspaceState();
      setTheme("system");
      setAppFont("system");
      setUser(result.user);
      setAuthRequired(false);
      setAuthMode("login");
      setUsername("");
      setRegisterPassword("");
      setSecurityKey("");
      await bootstrap();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? "That username is already in use."
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
    } finally {
      setBusy(false);
    }
  };

  const recoverPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(username, securityKey, newPassword);
      setAuthMode("login");
      setPassword("");
      setNewPassword("");
      setSecurityKey("");
      setError("Password reset. You can now sign in with your new password.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(newPassword);
      setCredentials({ username: user.username, password: newPassword });
      setNewPassword("");
      setError("Password updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };


  const updatePreferences = (nextTheme: Theme, nextFont: AppFont) => {
    setTheme(nextTheme);
    setAppFont(nextFont);
    void api.savePreferences(nextTheme, nextFont);
  };

  const createWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowTask.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { workflow } = await api.createWorkflow(
        workflowTask.trim(),
        verificationProfile,
        workflowTemplateId || undefined,
      );
      setWorkflows((current) => [workflow, ...current]);
      setSelectedWorkflowId(workflow.id);
      setSelectedId(null);
      setWorkflowTask("");
      setWorkflowTemplateId("");
      setShowWorkflowCreate(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const workflowAction = async (action: "start" | "pause" | "cancel") => {
    if (!selectedWorkflow) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "start"
          ? await api.startWorkflow(selectedWorkflow.id)
          : action === "pause"
            ? await api.pauseWorkflow(selectedWorkflow.id)
            : await api.cancelWorkflow(selectedWorkflow.id);
      setWorkflows((current) =>
        current.map((item) =>
          item.id === result.workflow.id ? result.workflow : item,
        ),
      );
      await refreshWorkflow(result.workflow.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const reviewStage = async (
    stageId: string,
    action: "approve" | "reject" | "revise" | "edit",
    value = "",
  ) => {
    if (!selectedWorkflow) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "approve"
          ? await api.approveStage(selectedWorkflow.id, stageId)
          : action === "reject"
            ? await api.rejectStage(selectedWorkflow.id, stageId, value)
            : action === "revise"
              ? await api.reviseStage(selectedWorkflow.id, stageId, value)
              : await api.editStage(selectedWorkflow.id, stageId, value);
      setReviewInput("");
      setWorkflows((current) =>
        current.map((item) =>
          item.id === result.workflow.id ? result.workflow : item,
        ),
      );
      await refreshWorkflow(result.workflow.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (authRequired === null) {
    return (
      <main className="auth-screen">
        <section className="auth-card" aria-live="polite">
          <div className="brand-mark">A</div>
          <span className="eyebrow">Agent Launchpad</span>
          <h1>Connecting to the control plane</h1>
          {error ? (
            <div className="error-banner" role="alert">
              {error}
            </div>
          ) : (
            <Spinner />
          )}
        </section>
      </main>
    );
  }

  if (authRequired) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={authMode === "register" ? register : authMode === "recover" ? recoverPassword : unlock}>
          <div className="brand-mark">A</div>
          <span className="eyebrow">Agent Launchpad</span>
          <h1>
            {authMode === "register" ? "Create your account" : authMode === "recover" ? "Reset your password" : "Sign in to Launchpad"}
          </h1>
          <p>
            {authMode === "register"
              ? "Create an account to save your agents and preferences."
              : authMode === "recover"
                ? "Enter your username, security key, and a new password."
                : "Enter your username and password."}
          </p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <label>
            Username
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            {authMode === "recover" ? "New password" : "Password"}
            <span className="password-field">
              <input
                type={authMode === "login" ? (showSignInPassword ? "text" : "password") : (showRegistrationPassword ? "text" : "password")}
                value={authMode === "register" ? registerPassword : authMode === "recover" ? newPassword : password}
                onChange={(event) =>
                  authMode === "register"
                    ? setRegisterPassword(event.target.value)
                    : authMode === "recover"
                      ? setNewPassword(event.target.value)
                      : setPassword(event.target.value)
                }
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                minLength={8}
                required
              />
              <button type="button" className="password-toggle" onClick={() => authMode === "login" ? setShowSignInPassword((value) => !value) : setShowRegistrationPassword((value) => !value)}>
                {(authMode === "login" ? showSignInPassword : showRegistrationPassword) ? "Hide password" : "Show password"}
              </button>
            </span>
          </label>
          {authMode !== "login" && <label>
            {authMode === "recover" ? "Security key" : "Create a security key"}
            <span className="password-field">
              <input
                type={showSecurityKey ? "text" : "password"}
                value={securityKey}
                onChange={(event) => setSecurityKey(event.target.value)}
                minLength={3}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowSecurityKey((value) => !value)}
              >
                {showSecurityKey ? "Hide security key" : "Show security key"}
              </button>
            </span>
          </label>}
          {authMode === "login" && <label className="trap-field" aria-hidden="true">
            Leave blank
            <input
              tabIndex={-1}
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </label>}
          <button
            className="button button-primary"
            disabled={
              busy ||
              !username.trim() ||
              !(authMode === "register" ? registerPassword : authMode === "recover" ? newPassword : password) ||
              (authMode !== "login" && !securityKey.trim())
            }
          >
            {busy ? (
              <Spinner />
            ) : authMode === "register" ? "Create account" : authMode === "recover" ? "Reset password" : "Open Launchpad"}
          </button>
          {authMode !== "recover" && <button
            type="button"
            className="auth-link"
            onClick={() => {
              setAuthMode(authMode === "register" ? "login" : "register");
              setError(null);
            }}
          >
            {authMode === "register"
              ? "Already have an account? Sign in"
              : "Create account"}
          </button>}
          {authMode === "login" && <button
            type="button"
            className="auth-link"
            onClick={() => { setAuthMode("recover"); setError(null); }}
          >
            Forgot password?
          </button>}
          {authMode === "recover" && <button
            type="button"
            className="auth-link"
            onClick={() => { setAuthMode("login"); setError(null); }}
          >
            Back to sign in
          </button>}
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Agent Launchpad</strong>
            <span>
              {system?.runtimeProvider === "container"
                ? "Local container · Codex CLI"
                : "ECS / Docker · Codex CLI"}
            </span>
          </div>
        </div>

        <button
          className="button button-primary create-button"
          onClick={() => {
            setForm(emptyForm);
            setShowCreate(true);
          }}
        >
          <span>＋</span> Create Agent
        </button>

        <div className="sidebar-label">
          <span>Your Agents</span>
          <span>{agents.length}</span>
        </div>
        <nav className="agent-list">
          {agents.map((agent) => (
            <button
              className={
                "agent-card " + (agent.id === selectedId ? "selected" : "")
              }
              key={agent.id}
              onClick={() => {
                setSelectedId(agent.id);
                setSelectedWorkflowId(null);
              }}
            >
              <div className="agent-avatar">
                {agent.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="agent-card-copy">
                <strong>{agent.name}</strong>
                <span>{agent.description || "Coding Agent"}</span>
              </div>
              <span className={"mini-dot mini-" + agent.status} />
            </button>
          ))}
          {agents.length === 0 && (
            <div className="empty-sidebar">
              <span>◇</span>
              Create your first coding Agent.
            </div>
          )}
        </nav>

        <div className="sidebar-label workflow-label">
          <span>Workflows</span>
          <span>{workflows.length}</span>
        </div>
        <nav className="agent-list workflow-list" aria-label="Workflows">
          {workflows.map((workflow) => (
            <button
              className={
                "agent-card " +
                (workflow.id === selectedWorkflowId ? "selected" : "")
              }
              key={workflow.id}
              onClick={() => {
                setSelectedWorkflowId(workflow.id);
                setSelectedId(null);
              }}
            >
              <div className="agent-avatar workflow-avatar">◇</div>
              <div className="agent-card-copy">
                <strong>{workflow.taskDescription}</strong>
                <span>{workflow.status.replace("_", " ")}</span>
              </div>
            </button>
          ))}
        </nav>
        <button
          className="button button-ghost workflow-create"
          onClick={() => setShowWorkflowCreate(true)}
        >
          ＋ New workflow
        </button>

        <div className="runtime-card">
          <span className="eyebrow">Runtime</span>
          <strong>{system?.runtime ?? "Checking…"}</strong>
          <span>
            {system?.arkModel ?? "Ark model not configured"}
            {system?.containerEngine ? " · " + system.containerEngine : ""}
          </span>
        </div>
        {user && (
          <div className="profile-area">
            <button
              className="profile-button"
              aria-label="Open profile settings"
              onClick={() => setShowProfile((v) => !v)}
            >
              <span className="profile-icon">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <span>{user.username}</span>
              <span>⌃</span>
            </button>
            {showProfile && (
              <div className="profile-menu">
                <strong>{user.username}</strong>
                <button
                  onClick={() => {
                    setShowProfile(false);
                    setShowAccountSettings(true);
                  }}
                >
                  Settings
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.logout();
                    } catch (reason) {
                      setError(reason instanceof Error ? reason.message : String(reason));
                    }
                    clearWorkspaceState();
                    setCredentials(null);
                    setTheme("system");
                    setAppFont("system");
                    setUser(null);
                    setAuthMode("login");
                    setUsername("");
                    setPassword("");
                    setRegisterPassword("");
                    setSecurityKey("");
                    setAuthRequired(true);
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="main">
        {!system?.arkConfigured || !system?.codexAvailable ? (
          <div className="config-banner">
            <span>!</span>
            <div>
              <strong>Runtime configuration needed</strong>
              <p>
                {!system?.arkConfigured
                  ? "Set ARK_API_KEY and ARK_MODEL in .env before using the Playground."
                  : system.runtimeProvider === "container"
                    ? "The local container engine or Agent Runtime image is unavailable. Rerun npm run poc."
                    : "Codex CLI was not found. Use the Docker image or install @openai/codex."}
              </p>
            </div>
          </div>
        ) : null}

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {selectedWorkflow ? (
          <>
            <header className="agent-header workflow-header">
              <div>
                <span className="eyebrow">Workflow chat</span>
                <h1>{selectedWorkflow.taskDescription}</h1>
                <p>
                  {selectedWorkflow.stages.length} Agents ·{" "}
                  {selectedWorkflow.verification.profile === "thorough"
                    ? "Thorough"
                    : selectedWorkflow.verification.profile === "token_saver"
                      ? "Minimal"
                      : "Balanced"}{" "}
                  verification
                </p>
              </div>
              <div className="header-actions">
                {selectedWorkflow.status === "paused" ||
                selectedWorkflow.status === "draft" ? (
                  <button
                    className="button button-primary"
                    onClick={() => void workflowAction("start")}
                    disabled={busy}
                  >
                    Start / Resume
                  </button>
                ) : null}
                {selectedWorkflow.status === "running" ? (
                  <button
                    className="button button-ghost"
                    onClick={() => void workflowAction("pause")}
                    disabled={busy}
                  >
                    Pause
                  </button>
                ) : null}
                {selectedWorkflow.status === "completed" ? <button className="button button-primary" disabled={busy} onClick={async () => { const task = window.prompt("What should the next workflow iteration add or change?"); if (!task?.trim()) return; setBusy(true); try { const result = await api.continueWorkflow(selectedWorkflow.id, task.trim(), selectedWorkflow.templateId); setWorkflows((current) => current.map((item) => item.id === result.workflow.id ? result.workflow : item)); await refreshWorkflow(result.workflow.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }}>Continue workflow</button> : null}
                {!["completed", "cancelled", "failed"].includes(
                  selectedWorkflow.status,
                ) ? (
                  <button
                    className="button button-danger"
                    onClick={() => void workflowAction("cancel")}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </header>
            <section className="playground workflow-playground">
              <div className="playground-topbar">
                <div>
                  <span className="eyebrow">Conversation</span>
                  <h2>Agents working together</h2>
                </div>
                <div className="session-info">
                  <span className="pulse" />
                  {selectedWorkflow.status.replace("_", " ")}
                </div>
              </div>
              <div
                className="workflow-stage-strip"
                aria-label="Workflow stages"
              >
                {selectedWorkflow.stages
                  .filter((stage) => stage.kind === "planned")
                  .map((stage, index, stages) => (
                    <div
                      className={`stage-node stage-${stage.status}`}
                      key={stage.id}
                    >
                      <span className="stage-node-marker" aria-hidden="true" />
                      <span className="stage-node-copy">
                        <strong>{stage.name}</strong>
                        <small>{stage.status.replace("_", " ")}</small>
                      </span>
                      {index < stages.length - 1 ? <span className="stage-node-line" aria-hidden="true" /> : null}
                    </div>
                  ))}
              </div>
              <div className="messages workflow-messages">
                {workflowMessages.length === 0 ? (
                  <div className="welcome">
                    <div className="welcome-orbit">
                      <div>⌁</div>
                    </div>
                    <h3>The conversation will appear here</h3>
                    <p>Each stage will report its progress and replies here.</p>
                  </div>
                ) : (
                  workflowMessages.map((message) => (
                    <article
                      className={`message message-${message.role} workflow-message ${message.role === "assistant" ? "identity-" + identityColour(message.agentId) : ""}`}
                      key={message.id}
                    >
                      <div
                        className={
                          message.role === "assistant"
                            ? "workflow-avatar-small"
                            : "workflow-avatar-small user-avatar"
                        }
                      >
                        {message.role === "assistant"
                          ? message.agentName.slice(0, 1).toUpperCase()
                          : "Y"}
                      </div>
                      <div className="workflow-message-content">
                        <div className="message-meta">
                          <strong>
                            {message.role === "user"
                              ? "You"
                              : message.agentName}
                          </strong>
                          <span>
                            {message.role === "assistant"
                              ? `${message.personaId ?? "Agent"} · ${message.stageName} · `
                              : "Workflow input · "}
                            {formatTime(message.createdAt)}
                          </span>
                        </div>
                        <div className="message-body">{message.content}</div>
                      </div>
                    </article>
                  ))
                )}
                {selectedWorkflow.stages
                  .filter((stage) => stage.status === "running")
                  .map((stage) => (
                    <article
                      className="workflow-activity thinking"
                      key={`thinking-${stage.id}`}
                    >
                      <Spinner />
                      <strong>{stage.name} is thinking…</strong>
                      <span>Working on the current stage</span>
                    </article>
                  ))}
                {workflowEvents
                  .slice(-3)
                  .filter(
                    (event) =>
                      event.event.includes("failed") ||
                      event.event.includes("retry") ||
                      event.event === "workflow_recovered",
                  )
                  .map((event) => (
                    <article className="workflow-activity" key={event.id}>
                      <strong>{event.event.replaceAll("_", " ")}</strong>
                      <span>{formatTime(event.timestamp)}</span>
                    </article>
                  ))}
                {selectedWorkflow.stages
                  .filter((stage) => stage.status === "awaiting_approval")
                  .map((stage) => (
                    <div className="review-panel" key={stage.id}>
                      <div>
                        <span className="eyebrow">Human review</span>
                        <strong>{stage.name} needs your decision</strong>
                        <p>
                          Approve the artifact to continue, or revise it with
                          specific feedback.
                        </p>
                      </div>
                      <textarea
                        value={reviewInput}
                        onChange={(event) => setReviewInput(event.target.value)}
                        placeholder="Tell the agent what to change…"
                        rows={2}
                      />
                      <div className="review-actions">
                        <button
                          className="button button-primary"
                          disabled={busy}
                          onClick={() => void reviewStage(stage.id, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          className="button button-ghost"
                          disabled={busy || !reviewInput.trim()}
                          onClick={() =>
                            void reviewStage(stage.id, "revise", reviewInput)
                          }
                        >
                          Revise with feedback
                        </button>
                      </div>
                    </div>
                  ))}
                {selectedWorkflow.stages
                  .filter((stage) => stage.status === "failed")
                  .map((stage) => (
                    <div
                      className="review-panel failure-panel"
                      key={`failed-${stage.id}`}
                    >
                      <strong>{stage.name} failed</strong>
                      <p>{stage.lastError}</p>
                      <button
                        className="button button-primary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const result = await api.retryStage(
                              selectedWorkflow.id,
                              stage.id,
                            );
                            setWorkflows((current) =>
                              current.map((item) =>
                                item.id === result.workflow.id
                                  ? result.workflow
                                  : item,
                              ),
                            );
                            await refreshWorkflow(result.workflow.id);
                          } catch (reason) {
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : String(reason),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Retry stage
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          </>
        ) : selected ? (
          <>
            <header className="agent-header">
              <div>
                <div className="header-title-row">
                  <h1>{selected.name}</h1>
                  <StatusPill status={selected.status} />
                </div>
                <p>
                  {selected.description ||
                    "A Codex coding Agent in an isolated workspace."}
                </p>
              </div>
              <div className="header-actions">
                <button
                  className="button button-ghost"
                  onClick={() => setShowSettings((value) => !value)}
                  disabled={busy || selected.status === "busy"}
                >
                  Settings
                </button>
                <button
                  className="button button-ghost"
                  onClick={toggleAgent}
                  disabled={busy}
                >
                  {selected.status === "stopped" ? "Start" : "Stop"}
                </button>
                <button
                  className="button button-danger"
                  onClick={deleteAgent}
                  disabled={busy || selected.status === "busy"}
                >
                  Delete
                </button>
              </div>
            </header>

            {showSettings && (
              <form className="settings-panel" onSubmit={saveAgent}>
                <div className="settings-title">
                  <div>
                    <span className="eyebrow">Agent configuration</span>
                    <h2>Instructions and identity</h2>
                  </div>
                  <button type="button" onClick={() => setShowSettings(false)}>
                    ×
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Name
                    <input
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Description
                    <input
                      value={form.description}
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                      maxLength={500}
                    />
                  </label>
                </div>
                <label>
                  System instructions
                  <textarea
                    value={form.instructions}
                    onChange={(event) =>
                      setForm({ ...form, instructions: event.target.value })
                    }
                    rows={5}
                    maxLength={10_000}
                  />
                </label>
                <div className="panel-footer">
                  <code>{selected.workspacePath}</code>
                  <button className="button button-primary" disabled={busy}>
                    {busy ? <Spinner /> : "Save changes"}
                  </button>
                </div>
              </form>
            )}

            <section className="playground">
              <div className="playground-topbar">
                <div>
                  <span className="eyebrow">Playground</span>
                  <h2>Build something with your Agent</h2>
                </div>
                <div className="session-info">
                  <span className="pulse" />
                  {selected.codexThreadId ? "Session connected" : "New session"}
                </div>
              </div>

              <div className="messages">
                {messages.length === 0 && !activeRun ? (
                  <div className="welcome">
                    <div className="welcome-orbit">
                      <div>⌁</div>
                    </div>
                    <h3>What should {selected.name} build?</h3>
                    <p>
                      The Agent can inspect files, write code, run commands, and
                      continue the same Codex session across messages.
                    </p>
                    <div className="prompt-grid">
                      {starterPrompts.map((item) => (
                        <button key={item} onClick={() => setPrompt(item)}>
                          <span>↗</span>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article
                      className={"message message-" + message.role}
                      key={message.id}
                    >
                      <div className="message-meta">
                        <strong>
                          {message.role === "user" ? "You" : selected.name}
                        </strong>
                        <span>{formatTime(message.createdAt)}</span>
                      </div>
                      <div className="message-body">{message.content}</div>
                    </article>
                  ))
                )}
                {activeRun &&
                  ["queued", "running"].includes(activeRun.status) && (
                    <article className="message message-assistant thinking">
                      <div className="message-meta">
                        <strong>{selected.name}</strong>
                        <span>working in the Agent workspace</span>
                      </div>
                      <div className="thinking-row">
                        <Spinner />
                        Codex is reading, editing, or running commands…
                      </div>
                    </article>
                  )}
                {activeRun?.status === "failed" && (
                  <article className="run-error">
                    <strong>Run failed</strong>
                    <span>{activeRun.error}</span>
                  </article>
                )}
                <div ref={messageEnd} />
              </div>

              <form className="composer" onSubmit={sendMessage}>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    selected.status === "stopped"
                      ? "Start this Agent to continue…"
                      : "Describe what you want the Agent to do…"
                  }
                  disabled={
                    selected.status === "stopped" ||
                    selected.status === "busy" ||
                    (activeRun != null &&
                      ["queued", "running"].includes(activeRun.status))
                  }
                  rows={3}
                />
                <div className="composer-footer">
                  <span>
                    Enter to send · Shift + Enter for newline ·{" "}
                    {system?.codexSandboxMode ?? "checking sandbox"}
                  </span>
                  <button
                    className="send-button"
                    disabled={
                      !prompt.trim() ||
                      selected.status === "stopped" ||
                      selected.status === "busy" ||
                      (activeRun != null &&
                        ["queued", "running"].includes(activeRun.status))
                    }
                    aria-label="Send message"
                  >
                    ↑
                  </button>
                </div>
              </form>
            </section>
          </>
        ) : (
          <div className="no-agent">
            <div className="no-agent-art">A</div>
            <span className="eyebrow">Agent Launchpad</span>
            <h1>Your runtime is ready for an Agent.</h1>
            <p>
              Create a workspace, give Codex a job, and continue the
              conversation here.
            </p>
            <button
              className="button button-primary"
              onClick={() => {
                setForm(emptyForm);
                setShowCreate(true);
              }}
            >
              Create your first Agent
            </button>
          </div>
        )}
      </main>

      {showWorkflowCreate && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowWorkflowCreate(false)}
        >
          <form
            className="modal"
            onSubmit={createWorkflow}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">New workflow</span>
                <h2>Start a group chat</h2>
                <p>Agents will take turns helping with this task.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowWorkflowCreate(false)}
              >
                ×
              </button>
            </div>
            <label>
              What should the Agents do?
              <textarea
                autoFocus
                value={workflowTask}
                onChange={(event) => setWorkflowTask(event.target.value)}
                rows={5}
                maxLength={50000}
                required
                placeholder="Describe the task…"
              />
            </label>
            <label>
              Workflow template
              <select value={workflowTemplateId} onChange={(event) => setWorkflowTemplateId(event.target.value)}>
                <option value="">Auto-plan from task</option>
                {workflowTemplates.map((template) => <option key={template.id} value={template.id}>{template.displayName} — {template.description}</option>)}
              </select>
            </label>
            <div className="preference-group">
              <span className="preference-label">
                Verification and token usage
              </span>
              <div
                className="verification-options"
                role="group"
                aria-label="Verification and token usage"
              >
                {verificationOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`quick-option ${verificationProfile === option.value ? "selected" : ""}`}
                    aria-pressed={verificationProfile === option.value}
                    onClick={() => setVerificationProfile(option.value)}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.help}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setShowWorkflowCreate(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={busy || !workflowTask.trim()}
              >
                {busy ? <Spinner /> : "Create workflow"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAccountSettings && user && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowAccountSettings(false)}
        >
          <section
            className="account-settings-modal"
            onMouseDown={(event) => event.stopPropagation()}
            aria-labelledby="account-settings-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Account</span>
                <h2 id="account-settings-title">Settings</h2>
                <p>Manage your Launchpad account and preferences.</p>
              </div>
              <button
                type="button"
                aria-label="Close settings"
                onClick={() => setShowAccountSettings(false)}
              >
                ×
              </button>
            </div>
            <div className="account-settings-body">
              <nav className="settings-nav" aria-label="Settings sections">
                <button
                  className={`settings-nav-item ${settingsTab === "password" ? "active" : ""}`}
                  type="button"
                  onClick={() => setSettingsTab("password")}
                >
                  Reset password
                </button>
                <button
                  className={`settings-nav-item ${settingsTab === "preferences" ? "active" : ""}`}
                  type="button"
                  onClick={() => setSettingsTab("preferences")}
                >
                  Theme
                </button>
              </nav>
              {settingsTab === "password" ? (
                <form className="settings-section" onSubmit={changePassword}>
                  <span className="eyebrow">Password</span>
                  <h3>Reset password</h3>
                  <p className="settings-help">
                    Choose a new password. Your current signed-in session confirms this change.
                  </p>
                  <label>
                    New password
                    <span className="password-field">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowNewPassword((value) => !value)}
                      >
                        {showNewPassword ? "Hide password" : "Show password"}
                      </button>
                    </span>
                  </label>
                  <button className="button button-primary" disabled={busy || !newPassword}>
                    {busy ? <Spinner /> : "Reset password"}
                  </button>
                </form>
              ) : (
                <div className="settings-section">
                  <span className="eyebrow">Preferences</span>
                  <h3>Personalize your workspace</h3>
                  <p className="settings-help">
                    Choose a comfortable theme and reading font. Changes apply
                    instantly.
                  </p>
                  <div className="preference-group">
                    <span className="preference-label">Theme</span>
                    <div
                      className="quick-options theme-options"
                      role="group"
                      aria-label="Theme"
                    >
                      {themeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`quick-option ${theme === option.value ? "selected" : ""}`}
                          aria-pressed={theme === option.value}
                          onClick={() =>
                            updatePreferences(option.value, appFont)
                          }
                        >
                          <span
                            className={`theme-swatch theme-${option.value}`}
                          />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="preference-group">
                    <span className="preference-label">Font</span>
                    <div
                      className="quick-options font-options"
                      role="group"
                      aria-label="Font"
                    >
                      {fontOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`quick-option font-${option.value} ${appFont === option.value ? "selected" : ""}`}
                          aria-pressed={appFont === option.value}
                          onClick={() => updatePreferences(theme, option.value)}
                        >
                          <span className="font-sample">{option.sample}</span>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {showCreate && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowCreate(false)}
        >
          <form
            className="modal"
            onSubmit={createAgent}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">New workspace</span>
                <h2>Create an Agent</h2>
                <p>
                  Each Agent gets a persistent folder and a resumable Codex
                  session.
                </p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)}>
                ×
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                placeholder="Frontend Builder"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
                maxLength={80}
              />
            </label>
            <label>
              Description
              <input
                placeholder="Builds polished React prototypes"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                maxLength={500}
              />
            </label>
            <label>
              Instructions
              <textarea
                value={form.instructions}
                onChange={(event) =>
                  setForm({ ...form, instructions: event.target.value })
                }
                rows={6}
                maxLength={10_000}
              />
            </label>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? <Spinner /> : "Create Agent"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
