import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { AuthService } from "./auth.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type { AgentService } from "./agent-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

describe("HTTP boundary", () => {
  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }),
      service,
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("preserves Fastify client error status codes", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(malformed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("accepts password changes using an account session without a shared token", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-auth-"));
    const store = new JsonStore(path.join(directory, "launchpad.json"));
    await store.initialize();
    const auth = new AuthService(store, []);
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, auth);

    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "operator", password: "old-password" },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = registered.headers["set-cookie"];
    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
      payload: { currentPassword: "old-password", newPassword: "new-password" },
    });
    expect(changed.statusCode).toBe(200);

    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists and returns account preferences", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-preferences-"));
    const store = new JsonStore(path.join(directory, "launchpad.json"));
    const preferenceStore = new JsonStore(path.join(directory, "preferences.json"), { version: 1 as const, preferences: [] });
    await store.initialize(); await preferenceStore.initialize();
    const auth = new AuthService(store, [], preferenceStore);
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, auth);
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "prefs", password: "password-1" } });
    const cookie = registered.headers["set-cookie"];
    const headers = { cookie: Array.isArray(cookie) ? cookie[0]! : cookie! };
    const saved = await app.inject({ method: "PATCH", url: "/api/auth/preferences", headers, payload: { theme: "ocean", font: "modern" } });
    expect(saved.statusCode).toBe(200);
    const loaded = await app.inject({ method: "GET", url: "/api/auth/preferences", headers });
    expect(loaded.statusCode).toBe(200);
    expect((loaded.json() as { preferences: { theme: string; font: string } }).preferences).toMatchObject({ theme: "ocean", font: "modern" });
    await app.close(); await rm(directory, { recursive: true, force: true });
  });
});
