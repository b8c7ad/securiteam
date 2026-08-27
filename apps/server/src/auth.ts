import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AppFont, PreferencesDatabase, Theme, User, UserPreference } from "./types.js";
import { HttpError } from "./errors.js";
import { JsonStore } from "./store.js";

const scrypt = promisify(scryptCallback);
const sessions = new Map<string, { user: User; expires: number }>();
const normalize = (v: string) => v.trim().toLowerCase();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export class AuthService {
  constructor(private readonly store: JsonStore, private readonly contributorKeys: string[], private readonly preferences?: JsonStore<PreferencesDatabase>) {}
  async initialize() {
    const keys = this.contributorKeys.filter(Boolean);
    if (!keys.length) return;
    await this.store.mutate(async db => {
      for (let i = 0; i < keys.length; i++) {
        const [username, password] = (keys[i] ?? "").split(":", 2);
        if (!username || !password || db.users.some(u => u.username === normalize(username))) continue;
        db.users.push({ id: randomUUID(), username: normalize(username), passwordHash: await hashPassword(password), createdAt: new Date().toISOString(), isContributor: true });
      }
    });
  }
  async login(username: string, password: string) {
    const user = this.store.snapshot().users.find(u => u.username === normalize(username));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "Invalid username or password");
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { user, expires: Date.now() + 1000 * 60 * 60 * 12 });
    return { token, user: { id: user.id, username: user.username, isContributor: user.isContributor } };
  }
  async register(username: string, password: string) {
    const normalized = normalize(username);
    if (this.store.snapshot().users.some(u => u.username === normalized)) {
      throw new HttpError(409, "That username is already in use");
    }
    const user = await this.store.mutate(async db => {
      if (db.users.some(u => u.username === normalized)) throw new HttpError(409, "That username is already in use");
      const created = { id: randomUUID(), username: normalized, passwordHash: await hashPassword(password), createdAt: new Date().toISOString(), isContributor: false };
      db.users.push(created);
      return created;
    });
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { user, expires: Date.now() + 1000 * 60 * 60 * 12 });
    return { token, user: { id: user.id, username: user.username, isContributor: user.isContributor } };
  }
  get(token: string | undefined): User {
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expires < Date.now()) throw new HttpError(401, "Authentication required");
    return session.user;
  }
  async changePassword(userId: string, current: string, next: string) {
    await this.store.mutate(async db => {
      const user = db.users.find(u => u.id === userId);
      if (!user || !(await verifyPassword(current, user.passwordHash))) {
        throw new HttpError(401, "Current password is incorrect");
      }
      user.passwordHash = await hashPassword(next);
    });
  }

  async getPreferences(username: string): Promise<UserPreference> {
    const normalized = normalize(username);
    return this.preferences?.snapshot().preferences.find((item) => item.username === normalized) ?? { username: normalized, theme: "system", font: "system", updatedAt: new Date().toISOString() };
  }

  async savePreferences(username: string, theme: Theme, font: AppFont): Promise<UserPreference> {
    const normalized = normalize(username);
    if (!this.preferences) throw new HttpError(500, "Preference store unavailable");
    return this.preferences.mutate((db) => {
      const item = db.preferences.find((preference) => preference.username === normalized);
      if (item) { item.theme = theme; item.font = font; item.updatedAt = new Date().toISOString(); return item; }
      const created = { username: normalized, theme, font, updatedAt: new Date().toISOString() };
      db.preferences.push(created); return created;
    });
  }
}
