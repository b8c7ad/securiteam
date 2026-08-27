import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Agent } from "./types.js";

export class WorkspaceManager {
  constructor(private readonly root: string) {}

  workspacePath(agentId: string): string {
    return path.join(this.root, agentId);
  }

  workflowStagePath(workflowId: string, stageId: string): string {
    return path.join(this.root, "workflows", workflowId, stageId);
  }

  async createWorkflowStage(workflowId: string, stageId: string): Promise<string> {
    const directory = this.workflowStagePath(workflowId, stageId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, ".deleted"), { recursive: true });
  }

  async describe(directory: string, maxChars = 16_000): Promise<string> {
    const lines: string[] = [];
    const ignored = new Set([".git", ".codex", "node_modules", "dist"]);
    const visit = async (current: string, relative: string, depth: number): Promise<void> => {
      if (depth > 3 || lines.join("\n").length >= maxChars) return;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const childRelative = relative ? relative + "/" + entry.name : entry.name;
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) { lines.push("DIR " + childRelative); await visit(child, childRelative, depth + 1); continue; }
        if (!entry.isFile()) continue;
        lines.push("FILE " + childRelative);
        try {
          const info = await stat(child);
          if (info.size <= 12_000 && /\.(md|txt|json|js|jsx|ts|tsx|css|html|yml|yaml|toml|py|sh)$/i.test(entry.name)) {
            const content = await readFile(child, "utf8");
            lines.push(content.slice(0, 2_000));
          }
        } catch { /* A changing workspace is still safe to summarize. */ }
      }
    };
    try { await visit(directory, "", 0); } catch { return "Workspace is not readable."; }
    const result = lines.join("\n");
    return result.length <= maxChars ? result : result.slice(0, maxChars) + "\n[Workspace context truncated.]";
  }

  async create(agent: Agent): Promise<void> {
    await mkdir(agent.workspacePath, { recursive: true });
    await this.writeInstructions(agent);
    await writeFile(
      path.join(agent.workspacePath, ".gitignore"),
      [".codex/", "node_modules/", "dist/", ".env", "*.log", ""].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(agent.workspacePath, "README.md"),
      [
        "# " + agent.name + " workspace",
        "",
        "Files created or edited by the Agent live here.",
        "The platform-generated AGENTS.md contains the current Agent instructions.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  async writeInstructions(agent: Agent): Promise<void> {
    const content = [
      "# Platform-managed Agent instructions",
      "",
      "You are the coding Agent named " + agent.name + ".",
      agent.description ? "Purpose: " + agent.description : "",
      "",
      "## Instructions",
      "",
      agent.instructions ||
        "Help the user complete coding tasks in this workspace. Explain material results concisely.",
      "",
      "## Workspace rules",
      "",
      "- Work only inside this workspace unless the user explicitly requests otherwise.",
      "- Preserve existing user files and avoid destructive operations.",
      "- Build and test changes when practical.",
      "- Never print environment variables or credentials.",
      "",
      "This file is regenerated when the Agent configuration is updated.",
      "",
    ]
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n");
    await writeFile(path.join(agent.workspacePath, "AGENTS.md"), content, "utf8");
  }

  async archive(agent: Agent): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(
      this.root,
      ".deleted",
      agent.id + "-" + timestamp,
    );
    await rename(agent.workspacePath, destination);
    return destination;
  }
}
