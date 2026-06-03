// Project/App: gsd-pi
// File Purpose: Auto-mode gate remediation classification, attempt bounding, and resolver-agent dispatch.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import type { Message } from "@gsd/pi-ai";

import type { GSDPreferences } from "./preferences.js";
import type { AutoResolvePreferences } from "./preferences-types.js";
import { getRuntimeKv, setRuntimeKv } from "./db/runtime-kv.js";
import { logWarning } from "./workflow-logger.js";
import { discoverAgents, type AgentConfig } from "../subagent/agents.js";
import { createSubagentLaunchPlan } from "../subagent/launch.js";

export const AUTO_RESOLVE_ATTEMPTS_KV_KEY = "auto_resolve_attempts";

export type AutoResolveGateKind =
  | "blocked"
  | "health-gate"
  | "plan-v2"
  | "merge-reconciliation"
  | "worktree-safety"
  | "provider"
  | "model-policy"
  | "budget"
  | "context-window"
  | "approval-gate"
  | "secrets"
  | "user-stop"
  | "user-backtrack"
  | "destructive-approval"
  | "unknown";

export interface ResolvedAutoResolvePreferences {
  enabled: boolean;
  max_attempts_per_gate: number;
  write_scope: "state-and-config";
  include_provider: boolean;
  include_budget_context: boolean;
}

export interface AutoResolveGateInput {
  kind: AutoResolveGateKind;
  reason: string;
  blockers?: readonly string[];
  basePath?: string;
  unitType?: string;
  unitId?: string;
  milestoneId?: string;
  prefs?: GSDPreferences | AutoResolvePreferences;
  ctx?: ExtensionContext;
  pi?: ExtensionAPI;
  attemptStore?: AutoResolveAttemptStore;
  runDeterministicRepairs?: (input: AutoResolveGateInput) => Promise<AutoResolveRepairResult>;
  runResolverAgent?: (input: AutoResolveAgentInput) => Promise<AutoResolveAgentResult>;
  recheckGate?: (input: AutoResolveGateInput) => Promise<boolean>;
}

export interface AutoResolveAgentInput extends AutoResolveGateInput {
  fingerprint: string;
  preferences: ResolvedAutoResolvePreferences;
}

export interface AutoResolveRepairResult {
  fixesApplied: string[];
  summary?: string;
}

export type AutoResolveStatus = "resolved" | "unresolved" | "unsafe" | "skipped";

export interface AutoResolveAgentResult {
  status: AutoResolveStatus;
  summary: string;
  evidence?: string[];
  changedPaths?: string[];
}

export interface AutoResolveDecision {
  action: "resume" | "pause" | "stop" | "skip";
  status: AutoResolveStatus;
  fingerprint?: string;
  summary: string;
  evidence?: string[];
  changedPaths?: string[];
}

export interface AutoResolveAttemptStore {
  get(fingerprint: string): number;
  record(fingerprint: string): void;
}

const runtimeFallbackAttempts = new Map<string, Record<string, number>>();

export function resolveAutoResolvePreferences(
  prefs: AutoResolvePreferences | null | undefined,
): ResolvedAutoResolvePreferences {
  return {
    enabled: prefs?.enabled ?? true,
    max_attempts_per_gate: Math.max(1, Math.min(5, Math.trunc(prefs?.max_attempts_per_gate ?? 1))),
    write_scope: "state-and-config",
    include_provider: prefs?.include_provider ?? true,
    include_budget_context: prefs?.include_budget_context ?? true,
  };
}

function extractAutoResolvePreferences(
  prefs: GSDPreferences | AutoResolvePreferences | null | undefined,
): AutoResolvePreferences | undefined {
  if (!prefs || typeof prefs !== "object") return undefined;
  if ("auto_resolve" in prefs) return (prefs as GSDPreferences).auto_resolve;
  return prefs as AutoResolvePreferences;
}

export function classifyAutoResolveGate(
  input: Pick<AutoResolveGateInput, "kind" | "reason" | "blockers">,
  prefs: ResolvedAutoResolvePreferences = resolveAutoResolvePreferences(undefined),
):
  | { eligible: true; gateKind: AutoResolveGateKind }
  | { eligible: false; gateKind: AutoResolveGateKind; reason: string } {
  const gateKind = input.kind;
  if (!prefs.enabled) return { eligible: false, gateKind, reason: "auto_resolve is disabled" };
  if (gateKind === "approval-gate" || gateKind === "destructive-approval") {
    return { eligible: false, gateKind, reason: "user approval gates are not auto-resolvable" };
  }
  if (gateKind === "secrets") {
    return { eligible: false, gateKind, reason: "secrets gates require user input" };
  }
  if (gateKind === "user-stop") {
    return { eligible: false, gateKind, reason: "explicit user stop gates are not auto-resolvable" };
  }
  if (gateKind === "user-backtrack") {
    return { eligible: false, gateKind, reason: "explicit user backtrack gates are not auto-resolvable" };
  }
  if ((gateKind === "provider" || gateKind === "model-policy") && !prefs.include_provider) {
    return { eligible: false, gateKind, reason: "provider/model gates are excluded by auto_resolve.include_provider" };
  }
  if ((gateKind === "budget" || gateKind === "context-window") && !prefs.include_budget_context) {
    return { eligible: false, gateKind, reason: "budget/context gates are excluded by auto_resolve.include_budget_context" };
  }
  return { eligible: true, gateKind };
}

function normalizeFingerprintText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildAutoResolveFingerprint(input: {
  basePath?: string;
  gateKind: AutoResolveGateKind;
  reason: string;
  unitType?: string;
  unitId?: string;
  milestoneId?: string;
}): string {
  const material = [
    input.basePath ?? "",
    input.gateKind,
    normalizeFingerprintText(input.reason),
    input.milestoneId ?? "",
    input.unitType ?? "",
    input.unitId ?? "",
  ].join("\0");
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 16);
  return `${input.gateKind}:${digest}`;
}

export function createMemoryAutoResolveAttemptStore(): AutoResolveAttemptStore {
  const attempts = new Map<string, number>();
  return {
    get(fingerprint: string) {
      return attempts.get(fingerprint) ?? 0;
    },
    record(fingerprint: string) {
      attempts.set(fingerprint, (attempts.get(fingerprint) ?? 0) + 1);
    },
  };
}

export function createRuntimeAutoResolveAttemptStore(basePath: string | undefined): AutoResolveAttemptStore {
  const scopeId = basePath ?? "";
  const readAttempts = (): Record<string, number> => {
    const stored = getRuntimeKv<Record<string, number>>("global", scopeId, AUTO_RESOLVE_ATTEMPTS_KV_KEY);
    if (stored && typeof stored === "object") return stored;
    return runtimeFallbackAttempts.get(scopeId) ?? {};
  };
  const writeAttempts = (attempts: Record<string, number>): void => {
    runtimeFallbackAttempts.set(scopeId, attempts);
    setRuntimeKv("global", scopeId, AUTO_RESOLVE_ATTEMPTS_KV_KEY, attempts);
  };
  return {
    get(fingerprint: string) {
      return readAttempts()[fingerprint] ?? 0;
    },
    record(fingerprint: string) {
      const attempts = { ...readAttempts() };
      attempts[fingerprint] = (attempts[fingerprint] ?? 0) + 1;
      writeAttempts(attempts);
    },
  };
}

export function shouldAttemptAutoResolve(
  store: AutoResolveAttemptStore,
  fingerprint: string,
  maxAttempts: number,
): { attempt: boolean; attempts: number; maxAttempts: number } {
  const attempts = store.get(fingerprint);
  return { attempt: attempts < maxAttempts, attempts, maxAttempts };
}

async function defaultDeterministicRepairs(input: AutoResolveGateInput): Promise<AutoResolveRepairResult> {
  if (!input.basePath) return { fixesApplied: [], summary: "No base path available for deterministic repair." };
  try {
    const { runGSDDoctor } = await import("./doctor.js");
    const report = await runGSDDoctor(input.basePath, { fix: true, fixLevel: "task" });
    return {
      fixesApplied: report.fixesApplied,
      summary: report.fixesApplied.length > 0
        ? `doctor heal applied ${report.fixesApplied.length} fix(es)`
        : "doctor heal found no deterministic fixes",
    };
  } catch (err) {
    return {
      fixesApplied: [],
      summary: `deterministic repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function findAutoResolverAgent(basePath: string | undefined): AgentConfig | null {
  const discovery = discoverAgents(basePath ?? process.cwd(), "both");
  return discovery.agents.find((agent) => agent.name === "auto-resolver") ?? null;
}

function writePromptToTempFile(agent: AgentConfig): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-auto-resolver-"));
  const filePath = join(dir, "prompt-auto-resolver.md");
  writeFileSync(filePath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
  return { dir, filePath };
}

function extractAssistantText(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as { type?: string; message?: Message };
    if (event.type !== "message_end" || event.message?.role !== "assistant") return null;
    for (const part of event.message.content) {
      if (part.type === "text") return part.text;
    }
  } catch {
    return null;
  }
  return null;
}

function parseResolverFinalText(text: string): AutoResolveAgentResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Partial<AutoResolveAgentResult>;
      if (
        parsed.status === "resolved" ||
        parsed.status === "unresolved" ||
        parsed.status === "unsafe" ||
        parsed.status === "skipped"
      ) {
        return {
          status: parsed.status,
          summary: typeof parsed.summary === "string" ? parsed.summary : text.trim(),
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((v): v is string => typeof v === "string") : undefined,
          changedPaths: Array.isArray(parsed.changedPaths) ? parsed.changedPaths.filter((v): v is string => typeof v === "string") : undefined,
        };
      }
    } catch (err) {
      logWarning("recovery", `auto-resolver result JSON parse failed: ${(err as Error).message}`);
    }
  }
  return { status: /resolved/i.test(text) ? "resolved" : "unresolved", summary: text.trim() || "auto-resolver returned no summary" };
}

export async function runDefaultAutoResolverAgent(input: AutoResolveAgentInput): Promise<AutoResolveAgentResult> {
  const agent = findAutoResolverAgent(input.basePath);
  if (!agent) return { status: "skipped", summary: "auto-resolver agent profile not found" };
  if (!process.env.GSD_BIN_PATH) return { status: "skipped", summary: "GSD_BIN_PATH is not available for resolver dispatch" };

  let tmp: { dir: string; filePath: string } | null = null;
  try {
    tmp = writePromptToTempFile(agent);
    const task = [
      `Gate kind: ${input.kind}`,
      `Fingerprint: ${input.fingerprint}`,
      `Reason: ${input.reason}`,
      input.blockers?.length ? `Blockers:\n${input.blockers.map((b) => `- ${b}`).join("\n")}` : "",
      input.unitType || input.unitId ? `Unit: ${input.unitType ?? "unknown"} ${input.unitId ?? "unknown"}` : "",
      input.milestoneId ? `Milestone: ${input.milestoneId}` : "",
      "",
      "Attempt bounded remediation within write_scope=state-and-config. Do not edit user source files.",
      "End with a single JSON object: {\"status\":\"resolved|unresolved|unsafe|skipped\",\"summary\":\"...\",\"evidence\":[\"...\"],\"changedPaths\":[\"...\"]}.",
    ].filter(Boolean).join("\n");
    const launch = createSubagentLaunchPlan({
      agent,
      task,
      tmpPromptPath: tmp.filePath,
      modelOverride: undefined,
      session: { mode: "fresh" },
      cwd: input.basePath,
      defaultCwd: input.basePath ?? process.cwd(),
    });

    const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
      .split(process.platform === "win32" ? ";" : ":")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const extensionArgs = bundledPaths.flatMap((p) => ["--extension", p]);
    const stdout = await new Promise<string>((resolve) => {
      const proc = spawn(
        process.execPath,
        [process.env.GSD_BIN_PATH!, ...extensionArgs, ...launch.args],
        { cwd: launch.cwd, env: launch.env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      proc.stdout.on("data", (chunk) => { output += chunk.toString(); });
      proc.stderr.on("data", (chunk) => { output += `\n${chunk.toString()}`; });
      proc.on("close", () => resolve(output));
      proc.on("error", (err) => resolve(`auto-resolver spawn failed: ${err.message}`));
    });
    const assistantTexts = stdout.split("\n").map(extractAssistantText).filter((v): v is string => Boolean(v));
    return parseResolverFinalText(assistantTexts.at(-1) ?? stdout);
  } finally {
    if (tmp) {
      try { unlinkSync(tmp.filePath); } catch (err) { logWarning("recovery", `auto-resolver prompt cleanup failed: ${(err as Error).message}`); }
      try { rmSync(tmp.dir, { recursive: true, force: true }); } catch (err) { logWarning("recovery", `auto-resolver temp directory cleanup failed: ${(err as Error).message}`); }
    }
  }
}

async function isGateCleared(input: AutoResolveGateInput): Promise<boolean> {
  if (!input.recheckGate) return false;
  try {
    return await input.recheckGate(input);
  } catch {
    return false;
  }
}

export async function maybeAutoResolveGate(input: AutoResolveGateInput): Promise<AutoResolveDecision> {
  const preferences = resolveAutoResolvePreferences(extractAutoResolvePreferences(input.prefs));
  const classification = classifyAutoResolveGate(input, preferences);
  if (!classification.eligible) {
    return { action: "skip", status: "skipped", summary: classification.reason };
  }

  const fingerprint = buildAutoResolveFingerprint({
    basePath: input.basePath,
    gateKind: classification.gateKind,
    reason: [
      input.reason,
      ...(input.blockers ?? []),
    ].join("\n"),
    unitType: input.unitType,
    unitId: input.unitId,
    milestoneId: input.milestoneId,
  });
  const store = input.attemptStore ?? createRuntimeAutoResolveAttemptStore(input.basePath);
  const attemptDecision = shouldAttemptAutoResolve(store, fingerprint, preferences.max_attempts_per_gate);
  if (!attemptDecision.attempt) {
    return {
      action: "skip",
      status: "skipped",
      fingerprint,
      summary: `auto-resolver already attempted ${attemptDecision.attempts}/${attemptDecision.maxAttempts} time(s) for this gate`,
    };
  }

  store.record(fingerprint);
  input.ctx?.ui.notify(`Auto-resolver: attempting ${classification.gateKind} remediation.`, "info");

  const repair = await (input.runDeterministicRepairs ?? defaultDeterministicRepairs)(input);
  if (repair.fixesApplied.length > 0 && await isGateCleared(input)) {
    return {
      action: "resume",
      status: "resolved",
      fingerprint,
      summary: repair.summary ?? `deterministic repair applied ${repair.fixesApplied.length} fix(es)`,
      evidence: repair.fixesApplied,
    };
  }

  const agentResult = await (input.runResolverAgent ?? runDefaultAutoResolverAgent)({
    ...input,
    fingerprint,
    preferences,
  });
  if (agentResult.status === "unsafe") {
    return { action: "pause", fingerprint, ...agentResult };
  }
  if (agentResult.status === "skipped") {
    return { action: "skip", fingerprint, ...agentResult };
  }
  if (agentResult.status === "resolved") {
    const cleared = await isGateCleared(input);
    if (!input.recheckGate || cleared) {
      return { action: "resume", fingerprint, ...agentResult };
    }
    return {
      action: "pause",
      status: "unresolved",
      fingerprint,
      summary: `${agentResult.summary}; gate remained after recheck`,
      evidence: agentResult.evidence,
      changedPaths: agentResult.changedPaths,
    };
  }
  return { action: "pause", fingerprint, ...agentResult };
}
