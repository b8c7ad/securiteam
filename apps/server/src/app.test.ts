import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { AuthService } from "./auth.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type { AgentService } from "./agent-service.js";
import type { CredentialsDatabase, PreferencesDatabase } from "./types.js";

const service = { listAgents: () => [], systemInfo: async () => ({}) } as unknown as AgentService;

describe("HTTP boundary", () => {
  it("keeps routes open when no account service is configured", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    expect((await app.inject({ method: "GET", url: "/api/agents" })).statusCode).toBe(200);
    await app.close();
  });

  it("uses the security key only to reset a forgotten password", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-auth-"));
    const credentials = new JsonStore<CredentialsDatabase>(path.join(directory, "credentials.json"), { version: 1, users: [] });
    await credentials.initialize();
    const auth = new AuthService(credentials, []);
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, auth);
    const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "operator", password: "old-password", securityKey: "operator-key" } });
    expect(registration.statusCode).toBe(201);
    expect(registration.headers["set-cookie"]).toBeUndefined();
    const headers = { "x-launchpad-username": "operator", "x-launchpad-password": "old-password" };
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "operator", password: "old-password" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { ...headers, "x-launchpad-security-key": "wrong-key" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/reset-password", payload: { username: "operator", password: "new-password", securityKey: "wrong-key" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/reset-password", payload: { username: "operator", password: "new-password", securityKey: "operator-key" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "operator", password: "new-password" } })).statusCode).toBe(200);
    await app.close(); await rm(directory, { recursive: true, force: true });
  });

  it("allows a signed-in user to change their password without a security key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-auth-"));
    const credentials = new JsonStore<CredentialsDatabase>(path.join(directory, "credentials.json"), { version: 1, users: [] });
    await credentials.initialize();
    const auth = new AuthService(credentials, []);
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, auth);
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "operator", password: "old-password", securityKey: "operator-key" } });
    expect((await app.inject({ method: "POST", url: "/api/auth/change-password", payload: { password: "new-password" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { "x-launchpad-username": "operator", "x-launchpad-password": "old-password" }, payload: { password: "new-password" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "operator", password: "new-password" } })).statusCode).toBe(200);
    await app.close(); await rm(directory, { recursive: true, force: true });
  });

  it("stores preferences separately and links them by username", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-preferences-"));
    const credentials = new JsonStore<CredentialsDatabase>(path.join(directory, "credentials.json"), { version: 1, users: [] });
    const preferences = new JsonStore<PreferencesDatabase>(path.join(directory, "preferences.json"), { version: 1, preferences: [] });
    await credentials.initialize(); await preferences.initialize();
    const auth = new AuthService(credentials, [], preferences);
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, auth);
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "prefs", password: "password-1", securityKey: "prefs-key" } });
    const headers = { "x-launchpad-username": "prefs", "x-launchpad-password": "password-1", "x-launchpad-security-key": "prefs-key" };
    expect((await app.inject({ method: "PATCH", url: "/api/auth/preferences", headers, payload: { theme: "ocean", font: "modern" } })).statusCode).toBe(200);
    expect(preferences.snapshot().preferences[0]).toMatchObject({ username: "prefs", theme: "ocean", font: "modern" });
    expect(credentials.snapshot().users[0]?.username).toBe("prefs");
    await app.close(); await rm(directory, { recursive: true, force: true });
  });
});
