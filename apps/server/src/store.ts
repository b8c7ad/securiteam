import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";

const emptyDatabase = (): Database => ({
  version: 2,
  agents: [],
  messages: [],
  runs: [],
  workflows: [],
  artifacts: [],
  repairGroups: [],
  reviewDecisions: [],
  verificationResults: [],
  workflowEvents: [],
});

type VersionedRecord = { version: number; [key: string]: unknown };

function migrateDatabase(value: VersionedRecord, expectedVersion: number): VersionedRecord {
  if (expectedVersion !== 2) return value;

  if (value.version === 2) {
    // Ensure all required fields exist in version 2
    const { users: _legacyUsers, ...applicationData } = value;
    return {
      ...applicationData,
      agents: Array.isArray(value.agents) ? (value.agents as Array<Record<string, unknown>>).map((agent) => ({ ...agent, visibility: agent.visibility === "internal" ? "internal" : "standalone" })) : [],
      messages: Array.isArray(value.messages) ? value.messages : [],
      runs: Array.isArray(value.runs) ? value.runs : [],
      workflows: Array.isArray(value.workflows) ? value.workflows : [],
      artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
      repairGroups: Array.isArray(value.repairGroups) ? value.repairGroups : [],
      reviewDecisions: Array.isArray(value.reviewDecisions) ? value.reviewDecisions : [],
      verificationResults: Array.isArray(value.verificationResults) ? value.verificationResults : [],
      workflowEvents: Array.isArray(value.workflowEvents) ? value.workflowEvents : [],
    };
  }
  if (value.version !== 1) return value;

  // Version 1 was the application database schema. New collections were added
  // over time, so missing collections are safe to initialize as empty arrays.
  if (!Array.isArray(value.agents) || !Array.isArray(value.messages) || !Array.isArray(value.runs)) {
    return value;
  }
  return {
    ...value,
    version: 2,
    agents: (value.agents as Array<Record<string, unknown>>).map((agent) => ({ ...agent, visibility: agent.visibility === "internal" ? "internal" : "standalone" })),
    workflows: Array.isArray(value.workflows) ? value.workflows : [],
    artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
    repairGroups: Array.isArray(value.repairGroups) ? value.repairGroups : [],
    reviewDecisions: Array.isArray(value.reviewDecisions) ? value.reviewDecisions : [],
    verificationResults: Array.isArray(value.verificationResults) ? value.verificationResults : [],
    workflowEvents: Array.isArray(value.workflowEvents) ? value.workflowEvents : [],
  };
}

export class JsonStore<T = Database> {
  private data: T;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, initialData?: T) { this.data = initialData ?? emptyDatabase() as T; }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as T;
      if (!parsed || typeof parsed !== "object" || !("version" in parsed)) {
        throw new Error("Unsupported database format");
      }
      const expectedVersion = (this.data as unknown as VersionedRecord).version;
      const migrated = migrateDatabase(parsed as unknown as VersionedRecord, expectedVersion);
      if (migrated.version !== expectedVersion) {
        throw new Error(`Unsupported database version: ${migrated.version}`);
      }
      this.data = migrated as T;
      if (migrated !== parsed) await this.persist(this.data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist(this.data);
    }
  }

  snapshot(): T {
    return structuredClone(this.data);
  }

  async mutate<R>(mutation: (database: T) => R | Promise<R>): Promise<R> {
    let result!: R;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      result = await mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(data: T = this.data): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
