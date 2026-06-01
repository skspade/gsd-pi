import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildMilestoneFileName,
  gsdRoot,
  resolveDir,
} from "./paths.js";
import type {
  RetrospectiveCategory,
  RetrospectiveConfidence,
  RetrospectiveFinding,
  RetrospectiveIssueMap,
  RetrospectiveSeverity,
} from "./retrospective-types.js";

const CATEGORIES = new Set<RetrospectiveCategory>([
  "bug",
  "prompt",
  "workflow-friction",
  "missing-agent",
  "automation-idea",
  "docs",
  "other",
]);
const SEVERITIES = new Set<RetrospectiveSeverity>(["low", "medium", "high"]);
const CONFIDENCES = new Set<RetrospectiveConfidence>(["low", "medium", "high"]);
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

export interface RetrospectivePaths {
  milestoneDir: string;
  retro: string;
  issueMap: string;
}

export interface ParsedRetrospective {
  ok: boolean;
  findings: RetrospectiveFinding[];
  error?: string;
  rawJson?: string;
}

export function resolveRetrospectivePaths(basePath: string, milestoneId: string): RetrospectivePaths {
  const root = gsdRoot(basePath);
  const milestonesDir = join(root, "milestones");
  const milestoneDirName = resolveDir(milestonesDir, milestoneId) ?? milestoneId;
  const milestoneDir = join(milestonesDir, milestoneDirName);

  return {
    milestoneDir,
    retro: join(milestoneDir, buildMilestoneFileName(milestoneId, "RETRO")),
    issueMap: join(milestoneDir, buildMilestoneFileName(milestoneId, "RETRO-ISSUES").replace(/\.md$/, ".json")),
  };
}

export function computeFindingFingerprint(finding: Pick<RetrospectiveFinding, "category" | "title" | "evidence">): string {
  const payload = {
    category: normalizeFingerprintText(finding.category),
    title: normalizeFingerprintText(finding.title),
    evidence: finding.evidence.map(normalizeFingerprintText),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function extractFindingsJson(markdown: string): string | null {
  const match = markdown.match(/```json\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

export function parseRetrospectiveMarkdown(markdown: string): ParsedRetrospective {
  const rawJson = extractFindingsJson(markdown);
  if (!rawJson) {
    return { ok: false, findings: [], error: "missing fenced json findings block" };
  }
  try {
    const parsed = JSON.parse(rawJson);
    const rawFindings = isRecord(parsed) && Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = rawFindings
      .map(validateFinding)
      .filter((finding): finding is RetrospectiveFinding => finding !== null);
    return { ok: true, findings, rawJson };
  } catch (error) {
    return {
      ok: false,
      findings: [],
      rawJson,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readIssueMap(path: string): RetrospectiveIssueMap | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RetrospectiveIssueMap;
  } catch {
    return null;
  }
}

export function writeIssueMap(path: string, issueMap: RetrospectiveIssueMap): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(issueMap, null, 2)}\n`, "utf-8");
}

function validateFinding(value: unknown): RetrospectiveFinding | null {
  if (!isRecord(value)) return null;

  const title = asString(value.title);
  const summary = asString(value.summary);
  const category = asEnum(value.category, CATEGORIES);
  const severity = asEnum(value.severity, SEVERITIES);
  const confidence = asEnum(value.confidence, CONFIDENCES);
  const evidence = asStringArray(value.evidence);
  const suggestedFix = asString(value.suggestedFix) ?? asString(value.suggested_fix);
  if (!title || !summary || !category || !severity || !confidence || evidence.length === 0 || !suggestedFix) {
    return null;
  }

  const candidate: Omit<RetrospectiveFinding, "fingerprint"> = {
    title,
    summary,
    category,
    severity,
    confidence,
    evidence,
    suggestedFix,
  };

  const suppliedFingerprint = asString(value.fingerprint)?.toLowerCase();
  const fingerprint = suppliedFingerprint && FINGERPRINT_RE.test(suppliedFingerprint)
    ? suppliedFingerprint
    : computeFindingFingerprint(candidate);

  return { ...candidate, fingerprint };
}

function asEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? value as T : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function normalizeFingerprintText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
