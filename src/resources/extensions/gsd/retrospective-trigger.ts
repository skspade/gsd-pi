import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildRetrospectMilestonePrompt } from "./auto-prompts.js";
import type { SidecarItem } from "./auto/session.js";
import type { RetrospectiveOutcome } from "./retrospective-types.js";

export interface PendingRetrospective {
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
}

const PENDING_RETROSPECTIVES_PATH = join(".gsd", "runtime", "pending-retrospectives.json");

function pendingRetrospectivesPath(basePath: string): string {
  return join(basePath, PENDING_RETROSPECTIVES_PATH);
}

function samePendingRetrospective(a: PendingRetrospective, b: PendingRetrospective): boolean {
  return a.milestoneId === b.milestoneId &&
    a.outcome === b.outcome &&
    (a.reason ?? "") === (b.reason ?? "");
}

function isPendingRetrospective(value: unknown): value is PendingRetrospective {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PendingRetrospective>;
  return typeof entry.milestoneId === "string" &&
    (entry.outcome === "completed" || entry.outcome === "failed" || entry.outcome === "stuck" || entry.outcome === "aborted") &&
    (entry.reason === undefined || typeof entry.reason === "string");
}

export function classifyRetrospectiveOutcomeFromStopReason(reason: string | undefined): RetrospectiveOutcome {
  const normalized = String(reason ?? "").toLowerCase();
  if (
    normalized.includes("stuck") ||
    normalized.includes("already-active") ||
    normalized.includes("timeout") ||
    normalized.includes("loop") ||
    normalized.includes("exhausted")
  ) {
    return "stuck";
  }
  if (
    normalized.includes("abort") ||
    normalized.includes("cancel") ||
    normalized.includes("user")
  ) {
    return "aborted";
  }
  return "failed";
}

export function readPendingRetrospectives(basePath: string): PendingRetrospective[] {
  const filePath = pendingRetrospectivesPath(basePath);
  if (!existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingRetrospective);
  } catch {
    return [];
  }
}

export function recordPendingRetrospective(basePath: string, entry: PendingRetrospective): void {
  const entries = readPendingRetrospectives(basePath);
  if (entries.some((candidate) => samePendingRetrospective(candidate, entry))) {
    return;
  }

  const filePath = pendingRetrospectivesPath(basePath);
  mkdirSync(join(basePath, ".gsd", "runtime"), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify([...entries, entry], null, 2)}\n`, "utf-8");
}

export function consumePendingRetrospectives(basePath: string): PendingRetrospective[] {
  const entries = readPendingRetrospectives(basePath);
  const filePath = pendingRetrospectivesPath(basePath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
  return entries;
}

export function removePendingRetrospective(basePath: string, entry: PendingRetrospective): void {
  const entries = readPendingRetrospectives(basePath);
  const remaining = entries.filter((candidate) => !samePendingRetrospective(candidate, entry));
  const filePath = pendingRetrospectivesPath(basePath);
  if (remaining.length === 0) {
    if (existsSync(filePath)) unlinkSync(filePath);
    return;
  }
  mkdirSync(join(basePath, ".gsd", "runtime"), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(remaining, null, 2)}\n`, "utf-8");
}

export async function buildRetrospectiveSidecar(
  basePath: string,
  entry: PendingRetrospective,
): Promise<SidecarItem> {
  return {
    kind: "retrospective",
    unitType: "retrospect-milestone",
    unitId: entry.milestoneId,
    prompt: await buildRetrospectMilestonePrompt(
      entry.milestoneId,
      basePath,
      entry.outcome,
      entry.reason,
    ),
    retrospectiveOutcome: entry.outcome,
    retrospectiveReason: entry.reason,
  };
}
