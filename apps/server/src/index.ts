import path from "node:path";
import { readFile } from "node:fs/promises";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import type { CredentialsDatabase, PreferencesDatabase } from "./types.js";
import { WorkspaceManager } from "./workspace.js";
import { AuthService } from "./auth.js";
import { WorkflowService } from "./workflow-service.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const credentials = new JsonStore<CredentialsDatabase>(path.join(config.dataDirectory, "credentials.json"), { version: 1, users: [] });
const preferences = new JsonStore<PreferencesDatabase>(path.join(config.dataDirectory, "user-preferences.json"), { version: 1, preferences: [] });
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
const legacyUsers = await readFile(path.join(config.dataDirectory, "launchpad.json"), "utf8")
  .then((raw) => (JSON.parse(raw) as { users?: unknown }).users)
  .catch(() => undefined);
await store.initialize();
await credentials.initialize();
await preferences.initialize();
const auth = new AuthService(credentials, config.contributorAccessKeys, preferences);
const workflows = new WorkflowService(store, service, config);
await service.initialize();
await auth.initialize();
await auth.importLegacy(legacyUsers);
await workflows.initialize();

const app = await createApp(config, service, auth, workflows);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
