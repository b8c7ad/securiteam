import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AppFont, Credential, CredentialsDatabase, PreferencesDatabase, Theme, User, UserPreference } from "./types.js";
import { HttpError } from "./errors.js";
import { JsonStore } from "./store.js";

const scrypt = promisify(scryptCallback);
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
  constructor(private readonly credentials: JsonStore<CredentialsDatabase>, private readonly contributorKeys: string[], private readonly preferences?: JsonStore<PreferencesDatabase>) {}
  async initialize() {
    const keys = this.contributorKeys.filter(Boolean);
    if (!keys.length) return;
    await this.credentials.mutate(async db => {
      for (let i = 0; i < keys.length; i++) {
        const [username, password] = (keys[i] ?? "").split(":", 2);
        if (!username || !password || db.users.some(u => u.username === normalize(username))) continue;
        db.users.push({ username: normalize(username), passwordHash: await hashPassword(password), securityKeyHash: await hashPassword(password), createdAt: new Date().toISOString(), isContributor: true });
      }
    });
  }
  /** One-time upgrade path for password hashes formerly stored with app data. */
  async importLegacy(users: unknown): Promise<void> {
    if (!Array.isArray(users)) return;
    await this.credentials.mutate((db) => {
      for (const value of users) {
        const user = value as Partial<Credential>;
        if (!user.username || !user.passwordHash || !user.securityKeyHash) continue;
        const username = normalize(user.username);
        if (!db.users.some((item) => item.username === username)) {
          db.users.push({ username, passwordHash: user.passwordHash, securityKeyHash: user.securityKeyHash, createdAt: user.createdAt ?? new Date().toISOString(), isContributor: user.isContributor === true });
        }
      }
    });
  }
  hasUsers(): boolean { return this.credentials.snapshot().users.length > 0; }
  private publicUser(user: Credential): User { return { username: user.username, isContributor: user.isContributor }; }
  async login(username: string, password: string): Promise<User> {
    return this.authenticate(username, password);
  }
  async authenticate(username: string, password: string): Promise<User> {
    const user = this.credentials.snapshot().users.find(u => u.username === normalize(username));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "Invalid username or password");
    return this.publicUser(user);
  }
  async register(username: string, password: string, securityKey: string): Promise<User> {
    const normalized = normalize(username);
    if (this.credentials.snapshot().users.some(u => u.username === normalized)) {
      throw new HttpError(409, "That username is already in use");
    }
    const user = await this.credentials.mutate(async db => {
      if (db.users.some(u => u.username === normalized)) throw new HttpError(409, "That username is already in use");
      const created = { username: normalized, passwordHash: await hashPassword(password), securityKeyHash: await hashPassword(securityKey), createdAt: new Date().toISOString(), isContributor: false };
      db.users.push(created);
      return created;
    });
    return this.publicUser(user);
  }

  async resetPassword(username: string, securityKey: string, password: string): Promise<void> {
    const normalized = normalize(username);
    const user = this.credentials.snapshot().users.find((item) => item.username === normalized);
    if (!user || !(await verifyPassword(securityKey, user.securityKeyHash))) {
      throw new HttpError(401, "Invalid username or security key");
    }
    await this.credentials.mutate(async (db) => {
      const credential = db.users.find((item) => item.username === normalized);
      if (!credential || !(await verifyPassword(securityKey, credential.securityKeyHash))) {
        throw new HttpError(401, "Invalid username or security key");
      }
      credential.passwordHash = await hashPassword(password);
    });
  }

  async changePassword(username: string, password: string): Promise<void> {
    const normalized = normalize(username);
    await this.credentials.mutate(async (db) => {
      const credential = db.users.find((item) => item.username === normalized);
      if (!credential) throw new HttpError(404, "Account not found");
      credential.passwordHash = await hashPassword(password);
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
