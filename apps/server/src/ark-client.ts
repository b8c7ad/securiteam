import type { AppConfig } from "./config.js";

export interface ArkVerifierResult { pass: boolean; severity: "info" | "warn" | "block"; issues: string[]; }

export async function verifyWithArk(config: AppConfig, prompt: string): Promise<ArkVerifierResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.arkBaseUrl + "/chat/completions", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: "Bearer " + config.arkApiKey }, body: JSON.stringify({ model: config.arkModel, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error("Verifier returned HTTP " + response.status);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Verifier returned no content");
    const parsed = JSON.parse(content) as Partial<ArkVerifierResult>;
    if (typeof parsed.pass !== "boolean" || !Array.isArray(parsed.issues) || !["info", "warn", "block"].includes(parsed.severity ?? "")) throw new Error("Verifier returned invalid JSON");
    return { pass: parsed.pass, severity: parsed.severity as ArkVerifierResult["severity"], issues: parsed.issues.map(String) };
  } finally { clearTimeout(timer); }
}
