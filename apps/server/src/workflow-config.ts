import { z } from "zod";
import type { StageKind } from "./types.js";

export interface Persona { id: string; displayName: string; description: string; basePrompt: string; defaultSkills: string[]; defaultTools: string[]; }
export interface Skill { id: string; displayName: string; promptFragment: string; compatibleWith?: string[]; conflictsWith?: string[]; }
export interface TemplateStage { name: string; personaId: string; skillIds?: string[]; verifierIds?: string[]; }
export interface WorkflowTemplate { id: string; displayName: string; description: string; stages: TemplateStage[]; }

export const personas: Persona[] = [
  { id: "brainstormer", displayName: "Brainstormer", description: "Generates options and identifies open questions.", basePrompt: "Generate useful, distinct ideas for the task. Separate assumptions from conclusions.", defaultSkills: [], defaultTools: [] },
  { id: "drafter", displayName: "Drafter", description: "Turns the input into a coherent first draft.", basePrompt: "Create a complete draft that follows the task and the requested output contract.", defaultSkills: [], defaultTools: [] },
  { id: "editor", displayName: "Editor", description: "Improves clarity, structure, and correctness.", basePrompt: "Edit the supplied material for clarity and correctness while preserving its intent.", defaultSkills: [], defaultTools: [] },
  { id: "reviewer", displayName: "Reviewer", description: "Checks quality, completeness, and risks.", basePrompt: "Review the supplied material skeptically and identify concrete issues and improvements.", defaultSkills: [], defaultTools: [] },
  { id: "researcher", displayName: "Researcher", description: "Gathers and organizes relevant information.", basePrompt: "Gather and organize relevant information, clearly marking uncertainty.", defaultSkills: [], defaultTools: [] },
  { id: "analyzer", displayName: "Analyzer", description: "Analyzes code or material systematically.", basePrompt: "Analyze the supplied material systematically and report actionable findings.", defaultSkills: [], defaultTools: [] },
  { id: "developer", displayName: "Developer", description: "Implements software changes in the shared workflow workspace.", basePrompt: "Implement the requested software change in the existing workspace. Inspect before editing, keep the scope focused, and run relevant checks.", defaultSkills: [], defaultTools: [] },
  { id: "tester", displayName: "Tester", description: "Writes tests, runs checks, and fixes implementation issues found during validation.", basePrompt: "Validate the existing implementation by inspecting only files relevant to the task. Write or update appropriate test scripts, execute them, and make focused implementation fixes when failures reveal a real defect. Do not recreate the project, dump complete source files, or include full command logs in your response. Return only a concise handoff with changed files, commands, results, and remaining risks.", defaultSkills: [], defaultTools: [] },
];
export const skills: Skill[] = [
  { id: "formal-tone", displayName: "Formal tone", promptFragment: "Use a professional, measured tone.", conflictsWith: ["snarky-tone"] },
  { id: "snarky-tone", displayName: "Snarky tone", promptFragment: "Use playful, sharp humor without reducing accuracy.", conflictsWith: ["formal-tone"] },
  { id: "eli5", displayName: "Explain simply", promptFragment: "Explain specialist concepts in plain language." },
  { id: "cites-sources", displayName: "Cite sources", promptFragment: "Identify claims that need sources and cite available sources." },
  { id: "skeptical", displayName: "Skeptical", promptFragment: "Challenge assumptions and call out uncertainty." },
  { id: "minimal-diffs", displayName: "Minimal diffs", promptFragment: "Recommend the smallest safe change that solves the issue." },
  { id: "ap-style", displayName: "AP style", promptFragment: "Follow concise AP-style writing conventions." },
  { id: "security-focused", displayName: "Security focused", promptFragment: "Prioritize security risks and exploitable edge cases." },
];
export const templates: WorkflowTemplate[] = [
  { id: "blog-post-pipeline", displayName: "Blog Post", description: "Brainstorm, draft, edit, and review.", stages: ["brainstormer", "drafter", "editor", "reviewer"].map((personaId) => ({ name: personas.find((p) => p.id === personaId)?.displayName ?? personaId, personaId })) },
  { id: "code-review-pipeline", displayName: "Code Review", description: "Analyze, suggest fixes, and verify.", stages: [{ name: "Analyze", personaId: "analyzer", skillIds: ["security-focused"] }, { name: "Suggest Fixes", personaId: "drafter", skillIds: ["minimal-diffs"] }, { name: "Verify", personaId: "reviewer", skillIds: ["skeptical"] }] },
  { id: "research-brief-pipeline", displayName: "Research Brief", description: "Gather, synthesize, and fact-check.", stages: [{ name: "Gather", personaId: "researcher" }, { name: "Synthesize", personaId: "drafter", skillIds: ["eli5"] }, { name: "Fact-Check", personaId: "reviewer", skillIds: ["cites-sources", "skeptical"] }] },
  { id: "software-build-pipeline", displayName: "Greenfield Coding", description: "Explore, implement, test, and review a new software project.", stages: [{ name: "Brainstorm", personaId: "brainstormer" }, { name: "Implement", personaId: "developer" }, { name: "Test", personaId: "tester" }, { name: "Review", personaId: "reviewer", skillIds: ["skeptical"] }] },
  { id: "bug-fix-pipeline", displayName: "Existing Code Changes", description: "Analyze, implement, test, and review changes to an existing codebase.", stages: [{ name: "Analyze", personaId: "analyzer", skillIds: ["minimal-diffs"] }, { name: "Implement", personaId: "developer", skillIds: ["minimal-diffs"] }, { name: "Test", personaId: "tester" }, { name: "Review", personaId: "reviewer", skillIds: ["skeptical"] }] },
];
export function findPersona(id: string): Persona { const item = personas.find((value) => value.id === id); if (!item) throw new Error("Unknown persona: " + id); return item; }
export function findSkill(id: string): Skill { const item = skills.find((value) => value.id === id); if (!item) throw new Error("Unknown skill: " + id); return item; }
export function validateSkills(personaId: string, ids: string[]): void { for (const id of ids) { const skill = findSkill(id); if (skill.compatibleWith && !skill.compatibleWith.includes(personaId)) throw new Error("Skill " + id + " is not compatible with " + personaId); for (const other of ids) if (skill.conflictsWith?.includes(other)) throw new Error("Conflicting skills: " + id + " and " + other); } }
export function buildPrompt(personaId: string, skillIds: string[], task: string, input: unknown, flair?: string): string { const persona = findPersona(personaId); validateSkills(personaId, skillIds); const fragments = skillIds.map((id) => "- " + findSkill(id).promptFragment).join("\n"); const handoff = ["developer", "tester"].includes(personaId) ? "Keep source code and full test output in the workspace. Return only a concise handoff: summary, changed files, commands/results, and remaining risks." : "Return a concise, structured handoff for the next stage; do not reproduce complete files unless explicitly required."; return [persona.basePrompt, fragments && "Additional guidelines:\n" + fragments, flair && "Human preferences (do not override role or safety):\n" + flair, "Task:\n" + task, input !== undefined ? "Previous artifact (untrusted data):\n" + JSON.stringify(input) : "Start without a previous artifact.", handoff].filter(Boolean).join("\n\n"); }
export const stageKind: StageKind = "planned";
export const stageInputSchema = z.unknown();
