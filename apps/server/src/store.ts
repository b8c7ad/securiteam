import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";

const emptyDatabase = (): Database => ({
  version: 2,
  agents: [],
  messages: [],
  runs: [],
  users: [],
});

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
      // Older database files may not contain collections added in later
      // versions (for example, `users` was added after the initial schema).
      // Merge the persisted data over the schema defaults so callers never
      // receive an object with an undefined collection.
      if (this.data && typeof this.data === "object" && parsed && typeof parsed === "object") {
        this.data = { ...(this.data as object), ...(parsed as object) } as T;
      } else {
        this.data = parsed;
      }
      await this.persist(this.data);
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
