import type { VerificationProfile, VerificationResultRecord } from "./types.js";

export interface VerificationInput { profile: VerificationProfile; attempt: number; maxAttempts: number; output: string; workflowId: string; stageId: string; artifactId: string; }
export interface VerificationDecision { pass: boolean; requiresHuman: boolean; retryable: boolean; records: Omit<VerificationResultRecord, "id" | "createdAt">[]; }

export function verifyOutput(input: VerificationInput): VerificationDecision {
  const issues: string[] = [];
  if (!input.output.trim()) issues.push("Agent output is empty");
  if (/\b(TODO|FIXME|PLACEHOLDER)\b/i.test(input.output)) issues.push("Output contains an unresolved placeholder");
  const lightweight = { workflowId: input.workflowId, stageId: input.stageId, artifactId: input.artifactId, attempt: input.attempt };
  const records: Omit<VerificationResultRecord, "id" | "createdAt">[] = [{ ...lightweight, hookId: "deterministic-structure", pass: issues.length === 0, severity: issues.length ? "block" : "info", issues }];
  const full = input.profile !== "token_saver" || input.attempt >= input.maxAttempts;
  if (full) records.push({ ...lightweight, hookId: "deterministic-completeness", pass: input.output.trim().length >= 10, severity: input.output.trim().length >= 10 ? "info" : "warn", issues: input.output.trim().length >= 10 ? [] : ["Output is unusually short"] });
  const blocking = records.some((record) => !record.pass && record.severity === "block");
  const warning = records.some((record) => !record.pass && record.severity === "warn");
  return { pass: !blocking && !warning, requiresHuman: warning || (blocking && input.attempt >= input.maxAttempts), retryable: blocking && input.attempt < input.maxAttempts, records };
}
