# Milestone Retrospective Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class milestone retrospective unit that analyzes completed, failed, stuck, or aborted milestone runs and automatically files one labeled GitHub issue per GSD improvement finding in `skspade/gsd-pi`.

**Architecture:** Implement `retrospect-milestone` as a built-in sidecar unit, not as user-configured hooks. The model writes a bounded local retrospective artifact; deterministic TypeScript validates findings, redacts issue bodies, enforces the personal-fork target, handles idempotency, and creates GitHub issues through the existing `gh` CLI wrapper.

**Tech Stack:** TypeScript, Node test runner, existing GSD auto-mode sidecar queue, existing prompt loader, existing GitHub Sync `gh` wrapper, pnpm

**Spec:** `docs/dev/superpowers/specs/2026-06-01-milestone-retrospective-agent-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/resources/extensions/gsd/retrospective-types.ts` | Shared retrospective preference, finding, artifact, outcome, and issue-map types. |
| `src/resources/extensions/gsd/retrospective-redaction.ts` | Redact absolute paths, secrets, env values, and source-like code excerpts before GitHub filing. |
| `src/resources/extensions/gsd/retrospective-artifacts.ts` | Resolve artifact paths, parse model-authored `RETRO.md`, validate findings, compute fingerprints, and read/write `RETRO-ISSUES.json`. |
| `src/resources/extensions/gsd/retrospective-context.ts` | Collect bounded milestone context for the prompt from roadmap, summaries, validation, activity, journal, and failure markers. |
| `src/resources/extensions/gsd/retrospective-github.ts` | Format issue bodies, ensure the primary label when possible, dedup, file one issue per finding, and persist results. |
| `src/resources/extensions/gsd/retrospective-trigger.ts` | Decide when to enqueue or persist pending retrospective sidecars for successful and terminal runs. |
| `src/resources/extensions/gsd/prompts/retrospect-milestone.md` | Model prompt for writing `M###-RETRO.md` with structured JSON findings. |
| `src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts` | Unit tests for parsing, validation, fingerprinting, paths, and issue-map idempotency. |
| `src/resources/extensions/gsd/tests/retrospective-redaction.test.ts` | Unit tests for redaction behavior. |
| `src/resources/extensions/gsd/tests/retrospective-github.test.ts` | Unit tests for repo enforcement, issue body formatting, label handling, and pending payload persistence. |
| `src/resources/extensions/gsd/tests/retrospective-trigger.test.ts` | Unit tests for success and terminal-state enqueue decisions. |

### Modified Files

| File | Change |
|------|--------|
| `src/resources/extensions/gsd/preferences-types.ts` | Add `retrospective` preference shape and known key. |
| `src/resources/extensions/gsd/preferences.ts` | Merge global/project `retrospective` preferences. |
| `src/resources/extensions/gsd/preferences-validation.ts` | Validate retrospective config and reject upstream target. |
| `src/resources/extensions/gsd/templates/PREFERENCES.md` | Document default disabled retrospective config. |
| `src/resources/extensions/gsd/docs/preferences-reference.md` | Document retrospective preferences. |
| `src/resources/extensions/gsd/auto/session.ts` | Add `retrospective` sidecar kind. |
| `src/resources/extensions/gsd/auto/phases.ts` | Preserve retrospective sidecar outcome metadata on `currentUnit` while the unit finalizes. |
| `src/resources/extensions/gsd/auto/workflow-kernel.ts` | Map retrospective sidecar dispatch to verification-class scheduling. |
| `src/resources/extensions/gsd/auto/loop.ts` | Drain pending retrospective records before normal dispatch. |
| `src/resources/extensions/gsd/auto-post-unit.ts` | Enqueue successful closeout retrospectives and finalize retrospective issue filing after the unit completes. |
| `src/resources/extensions/gsd/auto.ts` | Record pending retrospective requests on stopped, failed, stuck, or aborted milestone-scoped exits. |
| `src/resources/extensions/gsd/auto-prompts.ts` | Add `buildRetrospectMilestonePrompt`. |
| `src/resources/extensions/gsd/auto-artifact-paths.ts` | Resolve and diagnose `M###-RETRO.md` for `retrospect-milestone`. |
| `src/resources/extensions/github-sync/cli.ts` | Add narrowly scoped helpers for issue search and label creation. |
| `src/resources/extensions/gsd/tests/preferences.test.ts` | Cover retrospective preference validation and known-key behavior. |
| `src/resources/extensions/gsd/tests/workflow-kernel.test.ts` | Cover retrospective sidecar scheduling classification. |
| `src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts` | Cover `retrospect-milestone` artifact resolution. |

---

## Task 1: Preferences And Shared Types

**Files:**
- Create: `src/resources/extensions/gsd/retrospective-types.ts`
- Modify: `src/resources/extensions/gsd/preferences-types.ts`
- Modify: `src/resources/extensions/gsd/preferences.ts`
- Modify: `src/resources/extensions/gsd/preferences-validation.ts`
- Modify: `src/resources/extensions/gsd/tests/preferences.test.ts`

- [ ] **Step 1: Write failing preference tests**

Append these tests to `src/resources/extensions/gsd/tests/preferences.test.ts` near the other top-level preference validation tests:

```ts
test("retrospective preferences validate enabled personal fork config", () => {
  const result = validatePreferences({
    version: 1,
    retrospective: {
      enabled: true,
      issue_repo: "skspade/gsd-pi",
      issue_label: "gsd-auto-retro",
      max_issues_per_run: 7,
    },
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.preferences.retrospective?.enabled, true);
  assert.equal(result.preferences.retrospective?.issue_repo, "skspade/gsd-pi");
  assert.equal(result.preferences.retrospective?.issue_label, "gsd-auto-retro");
  assert.equal(result.preferences.retrospective?.max_issues_per_run, 7);
});

test("retrospective preferences reject upstream issue repo", () => {
  const result = validatePreferences({
    version: 1,
    retrospective: {
      enabled: true,
      issue_repo: "open-gsd/gsd-pi",
      issue_label: "gsd-auto-retro",
    },
  });

  assert.ok(
    result.errors.some((error) => error.includes("retrospective.issue_repo must not target open-gsd/gsd-pi")),
    `expected upstream rejection, got ${JSON.stringify(result.errors)}`,
  );
});

test("retrospective preferences reject any non-personal-fork issue repo", () => {
  const result = validatePreferences({
    version: 1,
    retrospective: {
      enabled: true,
      issue_repo: "someone-else/gsd-pi",
      issue_label: "gsd-auto-retro",
    },
  });

  assert.ok(
    result.errors.some((error) => error.includes("retrospective.issue_repo must be skspade/gsd-pi")),
    `expected personal-fork rejection, got ${JSON.stringify(result.errors)}`,
  );
});

test("retrospective is a recognized preference key", () => {
  assert.ok(KNOWN_PREFERENCE_KEYS.has("retrospective"));
  const result = validatePreferences({
    version: 1,
    retrospective: { enabled: false },
  });
  assert.equal(
    result.warnings.filter((warning) => warning.includes('unknown preference key "retrospective"')).length,
    0,
  );
});
```

- [ ] **Step 2: Run the preference tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/preferences.test.ts
```

Expected: FAIL because `retrospective` is an unknown preference key or `preferences.retrospective` is undefined.

- [ ] **Step 3: Add shared retrospective types**

Create `src/resources/extensions/gsd/retrospective-types.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Shared types for milestone retrospective analysis and issue filing.

export type RetrospectiveOutcome = "completed" | "failed" | "stuck" | "aborted";

export type RetrospectiveCategory =
  | "bug"
  | "prompt"
  | "workflow-friction"
  | "missing-agent"
  | "automation-idea"
  | "docs"
  | "other";

export type RetrospectiveSeverity = "low" | "medium" | "high";
export type RetrospectiveConfidence = "low" | "medium" | "high";

export interface RetrospectivePreferences {
  enabled?: boolean;
  issue_repo?: string;
  issue_label?: string;
  max_issues_per_run?: number;
}

export interface RetrospectiveFinding {
  title: string;
  summary: string;
  category: RetrospectiveCategory;
  severity: RetrospectiveSeverity;
  confidence: RetrospectiveConfidence;
  evidence: string[];
  suggestedFix: string;
  fingerprint: string;
}

export interface RetrospectiveRunMeta {
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
  generatedAt: string;
}

export interface RetrospectiveIssueRecord {
  fingerprint: string;
  title: string;
  category: RetrospectiveCategory;
  status: "created" | "pending" | "skipped";
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
  body?: string;
  updatedAt: string;
}

export interface RetrospectiveIssueMap {
  version: 1;
  milestoneId: string;
  issueRepo: string;
  issueLabel: string;
  records: RetrospectiveIssueRecord[];
}
```

- [ ] **Step 4: Wire `retrospective` into preference types**

Modify `src/resources/extensions/gsd/preferences-types.ts`:

```ts
import type { RetrospectivePreferences } from "./retrospective-types.js";
```

Add `"retrospective"` to `KNOWN_PREFERENCE_KEYS`.

Add this field to `GSDPreferences`:

```ts
  /** Milestone retrospective agent configuration. Disabled by default. */
  retrospective?: RetrospectivePreferences;
```

- [ ] **Step 5: Merge retrospective preferences**

Modify `mergePreferences` in `src/resources/extensions/gsd/preferences.ts` to include:

```ts
    retrospective: (base.retrospective || override.retrospective)
      ? { ...(base.retrospective ?? {}), ...(override.retrospective ?? {}) }
      : undefined,
```

Place it near `github` and `forensics_dedup`, since it is another GitHub-adjacent automation preference.

- [ ] **Step 6: Validate retrospective preferences**

Modify `src/resources/extensions/gsd/preferences-validation.ts` after the GitHub Sync section:

```ts
  // ─── Milestone Retrospective ───────────────────────────────────────────
  if (preferences.retrospective !== undefined) {
    if (typeof preferences.retrospective === "object" && preferences.retrospective !== null) {
      const raw = preferences.retrospective as Record<string, unknown>;
      const valid: Record<string, unknown> = {};

      if (raw.enabled !== undefined) {
        if (typeof raw.enabled === "boolean") valid.enabled = raw.enabled;
        else errors.push("retrospective.enabled must be a boolean");
      }

      if (raw.issue_repo !== undefined) {
        if (typeof raw.issue_repo === "string" && raw.issue_repo.includes("/")) {
          if (raw.issue_repo === "open-gsd/gsd-pi") {
            errors.push("retrospective.issue_repo must not target open-gsd/gsd-pi");
          } else if (raw.issue_repo !== "skspade/gsd-pi") {
            errors.push("retrospective.issue_repo must be skspade/gsd-pi");
          } else {
            valid.issue_repo = raw.issue_repo;
          }
        } else {
          errors.push('retrospective.issue_repo must be a string in "owner/repo" format');
        }
      }

      if (raw.issue_label !== undefined) {
        if (typeof raw.issue_label === "string" && raw.issue_label.trim()) {
          valid.issue_label = raw.issue_label.trim();
        } else {
          errors.push("retrospective.issue_label must be a non-empty string");
        }
      }

      if (raw.max_issues_per_run !== undefined) {
        const n = typeof raw.max_issues_per_run === "number"
          ? raw.max_issues_per_run
          : Number(raw.max_issues_per_run);
        if (Number.isFinite(n) && n > 0) valid.max_issues_per_run = Math.floor(n);
        else errors.push("retrospective.max_issues_per_run must be a positive number");
      }

      const knownRetroKeys = new Set(["enabled", "issue_repo", "issue_label", "max_issues_per_run"]);
      for (const key of Object.keys(raw)) {
        if (!knownRetroKeys.has(key)) {
          warnings.push(`unknown retrospective key "${key}" — ignored`);
        }
      }

      validated.retrospective = valid as GSDPreferences["retrospective"];
    } else {
      errors.push("retrospective must be an object");
    }
  }
```

- [ ] **Step 7: Run the preference tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/preferences.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/resources/extensions/gsd/retrospective-types.ts src/resources/extensions/gsd/preferences-types.ts src/resources/extensions/gsd/preferences.ts src/resources/extensions/gsd/preferences-validation.ts src/resources/extensions/gsd/tests/preferences.test.ts
git commit -m "feat(gsd): add retrospective preferences"
```

---

## Task 2: Artifact Parsing, Fingerprints, And Redaction

**Files:**
- Create: `src/resources/extensions/gsd/retrospective-artifacts.ts`
- Create: `src/resources/extensions/gsd/retrospective-redaction.ts`
- Create: `src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts`
- Create: `src/resources/extensions/gsd/tests/retrospective-redaction.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Create `src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeFindingFingerprint,
  parseRetrospectiveMarkdown,
  readIssueMap,
  resolveRetrospectivePaths,
  writeIssueMap,
} from "../retrospective-artifacts.ts";

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-retro-"));
  mkdirSync(join(dir, ".gsd", "milestones", "M001"), { recursive: true });
  return dir;
}

test("resolveRetrospectivePaths returns milestone retro artifacts", () => {
  const base = tempProject();
  const paths = resolveRetrospectivePaths(base, "M001");
  assert.equal(paths.retro.endsWith(".gsd/milestones/M001/M001-RETRO.md"), true);
  assert.equal(paths.issueMap.endsWith(".gsd/milestones/M001/M001-RETRO-ISSUES.json"), true);
});

test("parseRetrospectiveMarkdown validates findings from fenced JSON", () => {
  const markdown = [
    "# M001 Retrospective",
    "",
    "```json",
    JSON.stringify({
      findings: [
        {
          title: "Prompt asked the agent to inspect the wrong route",
          summary: "The run spent time in the wrong visualizer component.",
          category: "prompt",
          severity: "medium",
          confidence: "high",
          evidence: ["activity log mentioned NextGraphVisualizerView before correction"],
          suggestedFix: "Add route-owner grep guidance to the prompt.",
        },
      ],
    }),
    "```",
  ].join("\n");

  const parsed = parseRetrospectiveMarkdown(markdown);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]!.category, "prompt");
  assert.equal(parsed.findings[0]!.fingerprint.length, 64);
});

test("computeFindingFingerprint is stable for equivalent whitespace", () => {
  const a = computeFindingFingerprint({
    category: "bug",
    title: "  Bad Prompt   Loop ",
    evidence: ["  retries happened  "],
  });
  const b = computeFindingFingerprint({
    category: "bug",
    title: "bad prompt loop",
    evidence: ["retries happened"],
  });
  assert.equal(a, b);
});

test("writeIssueMap and readIssueMap round-trip records", () => {
  const base = tempProject();
  const paths = resolveRetrospectivePaths(base, "M001");
  writeIssueMap(paths.issueMap, {
    version: 1,
    milestoneId: "M001",
    issueRepo: "skspade/gsd-pi",
    issueLabel: "gsd-auto-retro",
    records: [
      {
        fingerprint: "abc",
        title: "One finding",
        category: "bug",
        status: "created",
        issueNumber: 123,
        issueUrl: "https://github.com/skspade/gsd-pi/issues/123",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });

  const loaded = readIssueMap(paths.issueMap);
  assert.equal(loaded?.records[0]?.issueNumber, 123);
  assert.equal(readFileSync(paths.issueMap, "utf8").includes("One finding"), true);
});
```

- [ ] **Step 2: Write failing redaction tests**

Create `src/resources/extensions/gsd/tests/retrospective-redaction.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { redactRetrospectiveIssueText } from "../retrospective-redaction.ts";

test("redactRetrospectiveIssueText strips absolute paths and secrets", () => {
  const input = [
    "Read /Users/seanspade/source/private-app/src/index.ts",
    "OPENAI_API_KEY=sk-proj-secret",
    "token: <github-token-like-value>",
  ].join("\n");

  const redacted = redactRetrospectiveIssueText(input, "/Users/seanspade/source/private-app");
  assert.doesNotMatch(redacted, /\/Users\/seanspade/);
  assert.doesNotMatch(redacted, /sk-proj-secret/);
  assert.doesNotMatch(redacted, /ghp_/);
  assert.match(redacted, /<project>/);
  assert.match(redacted, /<redacted>/);
});

test("redactRetrospectiveIssueText keeps GSD artifact references", () => {
  const input = "See .gsd/milestones/M001/M001-RETRO.md and command pnpm run test:unit.";
  const redacted = redactRetrospectiveIssueText(input, "/Users/seanspade/source/app");
  assert.match(redacted, /\.gsd\/milestones\/M001\/M001-RETRO\.md/);
  assert.match(redacted, /pnpm run test:unit/);
});
```

- [ ] **Step 3: Run artifact and redaction tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts src/resources/extensions/gsd/tests/retrospective-redaction.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement artifact parsing and issue-map persistence**

Create `src/resources/extensions/gsd/retrospective-artifacts.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Parses and persists milestone retrospective artifacts.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildMilestoneFileName, gsdRoot, resolveDir } from "./paths.js";
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
  const milestonesRoot = join(gsdRoot(basePath), "milestones");
  const existing = resolveDir(milestonesRoot, milestoneId);
  const milestoneDir = join(milestonesRoot, existing ?? milestoneId);
  return {
    milestoneDir,
    retro: join(milestoneDir, buildMilestoneFileName(milestoneId, "RETRO")),
    issueMap: join(milestoneDir, buildMilestoneFileName(milestoneId, "RETRO-ISSUES").replace(/\.md$/, ".json")),
  };
}

function normalizeFingerprintPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeFindingFingerprint(input: {
  category: string;
  title: string;
  evidence: string[];
}): string {
  const evidence = input.evidence.map(normalizeFingerprintPart).filter(Boolean).slice(0, 5).join("|");
  const source = [
    normalizeFingerprintPart(input.category),
    normalizeFingerprintPart(input.title),
    evidence,
  ].join("\n");
  return createHash("sha256").update(source).digest("hex");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

function validateFinding(value: unknown): RetrospectiveFinding | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const title = asString(raw.title);
  const summary = asString(raw.summary);
  const suggestedFix = asString(raw.suggestedFix) ?? asString(raw.suggested_fix);
  const category = asString(raw.category) as RetrospectiveCategory | null;
  const severity = asString(raw.severity) as RetrospectiveSeverity | null;
  const confidence = asString(raw.confidence) as RetrospectiveConfidence | null;
  const evidence = asStringArray(raw.evidence);
  if (!title || !summary || !suggestedFix || evidence.length === 0) return null;
  if (!category || !CATEGORIES.has(category)) return null;
  if (!severity || !SEVERITIES.has(severity)) return null;
  if (!confidence || !CONFIDENCES.has(confidence)) return null;
  const suppliedFingerprint = asString(raw.fingerprint);
  return {
    title,
    summary,
    category,
    severity,
    confidence,
    evidence,
    suggestedFix,
    fingerprint: suppliedFingerprint && /^[a-f0-9]{64}$/i.test(suppliedFingerprint)
      ? suppliedFingerprint.toLowerCase()
      : computeFindingFingerprint({ category, title, evidence }),
  };
}

export function extractFindingsJson(markdown: string): string | null {
  const labeled = markdown.match(/```json\s*([\s\S]*?)```/i);
  return labeled?.[1]?.trim() || null;
}

export function parseRetrospectiveMarkdown(markdown: string): ParsedRetrospective {
  const rawJson = extractFindingsJson(markdown);
  if (!rawJson) {
    return { ok: false, findings: [], error: "missing fenced json findings block" };
  }
  try {
    const parsed = JSON.parse(rawJson) as { findings?: unknown[] };
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = rawFindings.map(validateFinding).filter((finding): finding is RetrospectiveFinding => finding !== null);
    return { ok: true, findings, rawJson };
  } catch (err) {
    return {
      ok: false,
      findings: [],
      rawJson,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function readIssueMap(path: string): RetrospectiveIssueMap | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RetrospectiveIssueMap;
  } catch {
    return null;
  }
}

export function writeIssueMap(path: string, map: RetrospectiveIssueMap): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 5: Implement redaction**

Create `src/resources/extensions/gsd/retrospective-redaction.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Redacts retrospective issue text before GitHub filing.

const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{8,}\b/g,
  /\b[A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Za-z0-9_]*\s*=\s*[^\s]+/gi,
  /\b(?:token|secret|api[_-]?key|password):\s*[^\s]+/gi,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactRetrospectiveIssueText(text: string, projectRoot: string): string {
  let result = text;
  if (projectRoot.trim()) {
    result = result.replace(new RegExp(escapeRegExp(projectRoot), "g"), "<project>");
  }
  result = result.replace(/\/Users\/[^/\s]+\/[^\s)`'"]+/g, (match) => {
    if (match.includes("/.gsd/")) return match.slice(match.indexOf(".gsd/"));
    return "<path>";
  });
  result = result.replace(/\/private\/(?:tmp|var)\/[^\s)`'"]+/g, "<path>");
  result = result.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\[^\s)`'"]+/g, "<path>");
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "<redacted>");
  }
  return result;
}
```

- [ ] **Step 6: Run artifact and redaction tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts src/resources/extensions/gsd/tests/retrospective-redaction.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/resources/extensions/gsd/retrospective-artifacts.ts src/resources/extensions/gsd/retrospective-redaction.ts src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts src/resources/extensions/gsd/tests/retrospective-redaction.test.ts
git commit -m "feat(gsd): add retrospective artifacts and redaction"
```

---

## Task 3: GitHub Filing Core

**Files:**
- Create: `src/resources/extensions/gsd/retrospective-github.ts`
- Create: `src/resources/extensions/gsd/tests/retrospective-github.test.ts`
- Modify: `src/resources/extensions/github-sync/cli.ts`
- Modify: `src/resources/extensions/github-sync/tests/cli.test.ts`

- [ ] **Step 1: Write failing GitHub wrapper tests**

Append to `src/resources/extensions/github-sync/tests/cli.test.ts`:

```ts
import {
  ghBuildIssueListArgsForTest,
  ghBuildLabelCreateArgsForTest,
} from "../cli.ts";

it("builds issue-list args for label-scoped all-state dedup", () => {
  assert.deepEqual(
    ghBuildIssueListArgsForTest("skspade/gsd-pi", "gsd-auto-retro", 100),
    [
      "issue",
      "list",
      "--repo",
      "skspade/gsd-pi",
      "--state",
      "all",
      "--label",
      "gsd-auto-retro",
      "--limit",
      "100",
      "--json",
      "number,title,body,url",
    ],
  );
});

it("builds label-create args for primary retrospective label", () => {
  assert.deepEqual(
    ghBuildLabelCreateArgsForTest("skspade/gsd-pi", "gsd-auto-retro"),
    [
      "label",
      "create",
      "gsd-auto-retro",
      "--repo",
      "skspade/gsd-pi",
      "--description",
      "Automatically created by GSD milestone retrospective",
      "--color",
      "5319e7",
      "--force",
    ],
  );
});
```

- [ ] **Step 2: Write failing retrospective filing tests**

Create `src/resources/extensions/gsd/tests/retrospective-github.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildRetrospectiveIssueBody,
  planRetrospectiveIssueFiling,
  resolveRetrospectiveFilingConfig,
} from "../retrospective-github.ts";
import type { RetrospectiveFinding } from "../retrospective-types.ts";

function finding(overrides: Partial<RetrospectiveFinding> = {}): RetrospectiveFinding {
  return {
    title: "Prompt confused two route owners",
    summary: "The run edited the wrong component before correction.",
    category: "prompt",
    severity: "medium",
    confidence: "high",
    evidence: ["activity log: wrong component first"],
    suggestedFix: "Add route-owner grep instruction.",
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

test("resolveRetrospectiveFilingConfig enforces personal fork target", () => {
  assert.deepEqual(
    resolveRetrospectiveFilingConfig({ enabled: true, issue_repo: "open-gsd/gsd-pi" }),
    { enabled: false, reason: "retrospective.issue_repo must not target open-gsd/gsd-pi" },
  );
  assert.deepEqual(
    resolveRetrospectiveFilingConfig({ enabled: true, issue_repo: "someone-else/gsd-pi" }),
    { enabled: false, reason: "retrospective.issue_repo must be skspade/gsd-pi" },
  );
  assert.deepEqual(
    resolveRetrospectiveFilingConfig({
      enabled: true,
      issue_repo: "skspade/gsd-pi",
      issue_label: "gsd-auto-retro",
      max_issues_per_run: 3,
    }),
    {
      enabled: true,
      issueRepo: "skspade/gsd-pi",
      issueLabel: "gsd-auto-retro",
      maxIssuesPerRun: 3,
    },
  );
});

test("buildRetrospectiveIssueBody includes label-review context and redacts paths", () => {
  const body = buildRetrospectiveIssueBody({
    basePath: "/Users/seanspade/source/private-app",
    milestoneId: "M001",
    outcome: "failed",
    reason: "artifact verification failed",
    finding: finding(),
    retroPath: ".gsd/milestones/M001/M001-RETRO.md",
  });

  assert.match(body, /Auto-generated by GSD milestone retrospective/);
  assert.match(body, /Milestone: `M001`/);
  assert.match(body, /Outcome: `failed`/);
  assert.doesNotMatch(body, /\/Users\/seanspade/);
});

test("planRetrospectiveIssueFiling caps findings and skips existing fingerprints", () => {
  const planned = planRetrospectiveIssueFiling({
    findings: [
      finding({ fingerprint: "a".repeat(64), title: "already filed" }),
      finding({ fingerprint: "b".repeat(64), title: "new one" }),
      finding({ fingerprint: "c".repeat(64), title: "over cap" }),
    ],
    existingFingerprints: new Set(["a".repeat(64)]),
    maxIssues: 1,
  });

  assert.deepEqual(planned.map((entry) => entry.fingerprint), ["b".repeat(64)]);
});
```

- [ ] **Step 3: Run GitHub tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/github-sync/tests/cli.test.ts src/resources/extensions/gsd/tests/retrospective-github.test.ts
```

Expected: FAIL because helper functions and retrospective filing module do not exist.

- [ ] **Step 4: Add GitHub CLI wrapper helpers**

Modify `src/resources/extensions/github-sync/cli.ts`:

```ts
export interface ListedIssue {
  number: number;
  title: string;
  body?: string;
  url?: string;
}

export function ghBuildIssueListArgsForTest(repo: string, label: string, limit: number): string[] {
  return [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--label",
    label,
    "--limit",
    String(limit),
    "--json",
    "number,title,body,url",
  ];
}

export function ghBuildLabelCreateArgsForTest(repo: string, label: string): string[] {
  return [
    "label",
    "create",
    label,
    "--repo",
    repo,
    "--description",
    "Automatically created by GSD milestone retrospective",
    "--color",
    "5319e7",
    "--force",
  ];
}

export function ghListIssuesByLabel(cwd: string, repo: string, label: string, limit = 100): GhResult<ListedIssue[]> {
  return runGhJson<ListedIssue[]>(ghBuildIssueListArgsForTest(repo, label, limit), cwd);
}

export function ghEnsureLabel(cwd: string, repo: string, label: string): GhResult<void> {
  const result = runGh(ghBuildLabelCreateArgsForTest(repo, label), cwd);
  if (!result.ok) return fail(result.error!);
  return ok(undefined);
}
```

- [ ] **Step 5: Implement retrospective GitHub planner and formatter**

Create `src/resources/extensions/gsd/retrospective-github.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Deterministic GitHub filing for milestone retrospective findings.

import type { RetrospectiveFinding, RetrospectiveOutcome, RetrospectivePreferences } from "./retrospective-types.js";
import { redactRetrospectiveIssueText } from "./retrospective-redaction.js";

export type RetrospectiveFilingConfig =
  | { enabled: false; reason: string }
  | { enabled: true; issueRepo: string; issueLabel: string; maxIssuesPerRun: number };

export interface BuildRetrospectiveIssueBodyInput {
  basePath: string;
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
  finding: RetrospectiveFinding;
  retroPath: string;
}

export function resolveRetrospectiveFilingConfig(
  prefs: RetrospectivePreferences | undefined,
): RetrospectiveFilingConfig {
  if (!prefs?.enabled) return { enabled: false, reason: "retrospective disabled" };
  if (!prefs.issue_repo) return { enabled: false, reason: "retrospective.issue_repo is not configured" };
  if (prefs.issue_repo === "open-gsd/gsd-pi") {
    return { enabled: false, reason: "retrospective.issue_repo must not target open-gsd/gsd-pi" };
  }
  if (prefs.issue_repo !== "skspade/gsd-pi") {
    return { enabled: false, reason: "retrospective.issue_repo must be skspade/gsd-pi" };
  }
  return {
    enabled: true,
    issueRepo: prefs.issue_repo,
    issueLabel: prefs.issue_label || "gsd-auto-retro",
    maxIssuesPerRun: prefs.max_issues_per_run ?? 10,
  };
}

export function buildRetrospectiveIssueTitle(finding: RetrospectiveFinding): string {
  return `[auto-retro][${finding.category}] ${finding.title}`;
}

export function buildRetrospectiveIssueBody(input: BuildRetrospectiveIssueBodyInput): string {
  const { finding } = input;
  const raw = [
    "## Auto Retrospective Finding",
    "",
    "Auto-generated by GSD milestone retrospective. False positives are acceptable; review via the auto-retro label.",
    "",
    "## Run",
    "",
    `- Milestone: \`${input.milestoneId}\``,
    `- Outcome: \`${input.outcome}\``,
    input.reason ? `- Reason: ${input.reason}` : "- Reason: not recorded",
    `- Local retrospective: \`${input.retroPath}\``,
    "",
    "## Finding",
    "",
    `- Category: \`${finding.category}\``,
    `- Severity: \`${finding.severity}\``,
    `- Confidence: \`${finding.confidence}\``,
    `- Fingerprint: \`${finding.fingerprint}\``,
    "",
    finding.summary,
    "",
    "## Evidence",
    "",
    ...finding.evidence.map((entry) => `- ${entry}`),
    "",
    "## Suggested Fix",
    "",
    finding.suggestedFix,
    "",
    "---",
    "*Auto-generated by GSD milestone retrospective*",
  ].join("\n");
  return redactRetrospectiveIssueText(raw, input.basePath);
}

export function planRetrospectiveIssueFiling(input: {
  findings: RetrospectiveFinding[];
  existingFingerprints: Set<string>;
  maxIssues: number;
}): RetrospectiveFinding[] {
  const planned: RetrospectiveFinding[] = [];
  for (const finding of input.findings) {
    if (input.existingFingerprints.has(finding.fingerprint)) continue;
    planned.push(finding);
    if (planned.length >= input.maxIssues) break;
  }
  return planned;
}
```

In the next task, this module will gain the side-effecting `fileRetrospectiveIssues` function after artifact persistence is in place.

- [ ] **Step 6: Run GitHub tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/github-sync/tests/cli.test.ts src/resources/extensions/gsd/tests/retrospective-github.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/resources/extensions/github-sync/cli.ts src/resources/extensions/github-sync/tests/cli.test.ts src/resources/extensions/gsd/retrospective-github.ts src/resources/extensions/gsd/tests/retrospective-github.test.ts
git commit -m "feat(gsd): add retrospective GitHub filing helpers"
```

---

## Task 4: Prompt, Context Collection, And Artifact Verification

**Files:**
- Create: `src/resources/extensions/gsd/retrospective-context.ts`
- Create: `src/resources/extensions/gsd/prompts/retrospect-milestone.md`
- Modify: `src/resources/extensions/gsd/auto-prompts.ts`
- Modify: `src/resources/extensions/gsd/auto-artifact-paths.ts`
- Modify: `src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts`
- Create: `src/resources/extensions/gsd/tests/retrospective-context.test.ts`

- [ ] **Step 1: Write failing artifact-path test**

Append to `src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts`:

```ts
test("resolveExpectedArtifactPath resolves milestone retrospective artifact", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-retro-artifact-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

  assert.equal(
    resolveExpectedArtifactPath("retrospect-milestone", "M001", base),
    join(base, ".gsd", "milestones", "M001", "M001-RETRO.md"),
  );
});
```

The file already imports `mkdtempSync`, `mkdirSync`, `join`, and `tmpdir`; add only `assert` usage in the test body and keep the existing cleanup pattern if you wrap the new test in `try/finally`.

- [ ] **Step 2: Write failing context collector test**

Create `src/resources/extensions/gsd/tests/retrospective-context.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildRetrospectiveContext } from "../retrospective-context.ts";

test("buildRetrospectiveContext includes bounded milestone artifacts and failure reason", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-retro-context-"));
  const milestoneDir = join(base, ".gsd", "milestones", "M001");
  mkdirSync(milestoneDir, { recursive: true });
  writeFileSync(join(milestoneDir, "M001-ROADMAP.md"), "# M001 Roadmap\n\nSuccess criteria here\n", "utf8");
  writeFileSync(join(milestoneDir, "M001-SUMMARY.md"), "# M001 Summary\n\nShipped feature\n", "utf8");

  const context = await buildRetrospectiveContext({
    basePath: base,
    milestoneId: "M001",
    outcome: "failed",
    reason: "artifact verification failed",
  });

  assert.match(context, /Outcome: failed/);
  assert.match(context, /artifact verification failed/);
  assert.match(context, /M001-ROADMAP.md/);
  assert.match(context, /Success criteria here/);
  assert.match(context, /M001-SUMMARY.md/);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts src/resources/extensions/gsd/tests/retrospective-context.test.ts
```

Expected: FAIL because `retrospect-milestone` is not resolved and `retrospective-context.ts` does not exist.

- [ ] **Step 4: Implement context collection**

Create `src/resources/extensions/gsd/retrospective-context.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Collects bounded context for milestone retrospective prompts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { gsdRoot, resolveMilestoneFile, resolveMilestonePath } from "./paths.js";
import type { RetrospectiveOutcome } from "./retrospective-types.js";

const MAX_FILE_CHARS = 12_000;
const MAX_ACTIVITY_FILES = 12;
const MAX_ACTIVITY_CHARS = 4_000;

export interface BuildRetrospectiveContextInput {
  basePath: string;
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
}

function readCapped(path: string, maxChars: number): string {
  const content = readFileSync(path, "utf8");
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[...truncated ${content.length - maxChars} chars]`;
}

function section(title: string, body: string): string {
  return [`## ${title}`, "", body.trim() || "(none)", ""].join("\n");
}

function artifactSection(basePath: string, title: string, path: string | null): string {
  if (!path || !existsSync(path)) return section(title, "(not present)");
  return section(`${title}: ${relative(basePath, path)}`, readCapped(path, MAX_FILE_CHARS));
}

function activitySections(basePath: string, milestoneId: string): string {
  const activityDir = join(gsdRoot(basePath), "activity");
  if (!existsSync(activityDir)) return section("Activity Logs", "(not present)");
  const files = readdirSync(activityDir)
    .filter((file) => file.includes(milestoneId))
    .sort()
    .slice(-MAX_ACTIVITY_FILES);
  if (files.length === 0) return section("Activity Logs", "(none for milestone)");
  const chunks = files.map((file) => {
    const path = join(activityDir, file);
    return [`### ${basename(file)}`, readCapped(path, MAX_ACTIVITY_CHARS)].join("\n\n");
  });
  return section("Activity Logs", chunks.join("\n\n"));
}

export async function buildRetrospectiveContext(input: BuildRetrospectiveContextInput): Promise<string> {
  const { basePath, milestoneId } = input;
  const milestoneDir = resolveMilestonePath(basePath, milestoneId);
  const retroTarget = milestoneDir ? join(milestoneDir, `${milestoneId}-RETRO.md`) : `${milestoneId}-RETRO.md`;
  return [
    "# Milestone Retrospective Context",
    "",
    `Milestone: ${milestoneId}`,
    `Outcome: ${input.outcome}`,
    `Reason: ${input.reason || "not recorded"}`,
    `Retrospective target: ${retroTarget}`,
    "",
    artifactSection(basePath, "Roadmap", resolveMilestoneFile(basePath, milestoneId, "ROADMAP")),
    artifactSection(basePath, "Summary", resolveMilestoneFile(basePath, milestoneId, "SUMMARY")),
    artifactSection(basePath, "Validation", resolveMilestoneFile(basePath, milestoneId, "VALIDATION")),
    artifactSection(basePath, "Learnings", resolveMilestoneFile(basePath, milestoneId, "LEARNINGS")),
    activitySections(basePath, milestoneId),
  ].join("\n");
}
```

- [ ] **Step 5: Add prompt template**

Create `src/resources/extensions/gsd/prompts/retrospect-milestone.md`:

```md
You are executing GSD auto-mode.

## UNIT: Retrospect Milestone {{milestoneId}}

## Mission

Analyze the milestone run and write a local retrospective artifact. Identify plausible GSD improvement signals, even if they might be false positives. Do not fix anything. Do not create GitHub issues. Do not call `gh`.

Valid finding categories:

- `bug`
- `prompt`
- `workflow-friction`
- `missing-agent`
- `automation-idea`
- `docs`
- `other`

Only include findings about GSD itself: product behavior, prompts, workflow mechanics, recovery, missing agents, automation opportunities, or docs. Ignore ordinary user-project implementation work unless the GSD workflow handled it poorly.

## Context

{{retrospectiveContext}}

## Required Output

Write `.gsd/milestones/{{milestoneId}}/{{milestoneId}}-RETRO.md`.

The file must contain:

1. A short markdown retrospective summary.
2. A fenced `json` block with this exact shape:

```json
{
  "findings": [
    {
      "title": "Short issue title",
      "summary": "What went wrong or could be improved.",
      "category": "prompt",
      "severity": "medium",
      "confidence": "high",
      "evidence": ["Specific bounded evidence from the provided context."],
      "suggestedFix": "Concrete next action."
    }
  ]
}
```

If there are no plausible findings, write `"findings": []`.
```

- [ ] **Step 6: Add prompt builder**

Modify `src/resources/extensions/gsd/auto-prompts.ts`:

```ts
import type { RetrospectiveOutcome } from "./retrospective-types.js";
import { buildRetrospectiveContext } from "./retrospective-context.js";
```

Add near `buildCompleteMilestonePrompt`:

```ts
export async function buildRetrospectMilestonePrompt(
  mid: string,
  base: string,
  outcome: RetrospectiveOutcome,
  reason?: string,
): Promise<string> {
  const retrospectiveContext = await buildRetrospectiveContext({
    basePath: base,
    milestoneId: mid,
    outcome,
    reason,
  });
  return loadPrompt("retrospect-milestone", {
    milestoneId: mid,
    retrospectiveContext,
  });
}
```

- [ ] **Step 7: Add artifact resolution**

Modify `resolveExpectedArtifactPath` in `src/resources/extensions/gsd/auto-artifact-paths.ts`:

```ts
    case "retrospect-milestone": {
      return resolveMilestoneArtifactPath(base, mid, "RETRO");
    }
```

Modify `diagnoseExpectedArtifact`:

```ts
    case "retrospect-milestone":
      return `${relMilestoneFile(base, mid, "RETRO")} (milestone retrospective with fenced JSON findings)`;
```

- [ ] **Step 8: Run tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts src/resources/extensions/gsd/tests/retrospective-context.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/resources/extensions/gsd/retrospective-context.ts src/resources/extensions/gsd/prompts/retrospect-milestone.md src/resources/extensions/gsd/auto-prompts.ts src/resources/extensions/gsd/auto-artifact-paths.ts src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts src/resources/extensions/gsd/tests/retrospective-context.test.ts
git commit -m "feat(gsd): add milestone retrospective prompt"
```

---

## Task 5: Lifecycle Triggers And Sidecar Dispatch

**Files:**
- Create: `src/resources/extensions/gsd/retrospective-trigger.ts`
- Create: `src/resources/extensions/gsd/tests/retrospective-trigger.test.ts`
- Modify: `src/resources/extensions/gsd/auto/session.ts`
- Modify: `src/resources/extensions/gsd/auto/phases.ts`
- Modify: `src/resources/extensions/gsd/auto/workflow-kernel.ts`
- Modify: `src/resources/extensions/gsd/tests/workflow-kernel.test.ts`
- Modify: `src/resources/extensions/gsd/auto-post-unit.ts`
- Modify: `src/resources/extensions/gsd/auto.ts`
- Modify: `src/resources/extensions/gsd/auto/loop.ts`

- [ ] **Step 1: Write failing trigger tests**

Create `src/resources/extensions/gsd/tests/retrospective-trigger.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildRetrospectiveSidecar,
  classifyRetrospectiveOutcomeFromStopReason,
  consumePendingRetrospectives,
  recordPendingRetrospective,
} from "../retrospective-trigger.ts";

function tempProject(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-retro-trigger-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  return base;
}

test("classifyRetrospectiveOutcomeFromStopReason maps stuck and failed reasons", () => {
  assert.equal(classifyRetrospectiveOutcomeFromStopReason("already-active dispatch claim"), "stuck");
  assert.equal(classifyRetrospectiveOutcomeFromStopReason("artifact verification failed"), "failed");
  assert.equal(classifyRetrospectiveOutcomeFromStopReason("user aborted run"), "aborted");
});

test("recordPendingRetrospective is idempotent per milestone outcome reason", () => {
  const base = tempProject();
  recordPendingRetrospective(base, { milestoneId: "M001", outcome: "failed", reason: "artifact verification failed" });
  recordPendingRetrospective(base, { milestoneId: "M001", outcome: "failed", reason: "artifact verification failed" });
  const pending = consumePendingRetrospectives(base);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.milestoneId, "M001");
});

test("buildRetrospectiveSidecar returns a first-class retrospective sidecar", async () => {
  const base = tempProject();
  const item = await buildRetrospectiveSidecar(base, {
    milestoneId: "M001",
    outcome: "completed",
    reason: "complete-milestone settled",
  });
  assert.equal(item.kind, "retrospective");
  assert.equal(item.unitType, "retrospect-milestone");
  assert.equal(item.unitId, "M001");
  assert.equal(item.retrospectiveOutcome, "completed");
  assert.equal(item.retrospectiveReason, "complete-milestone settled");
  assert.match(item.prompt, /Retrospect Milestone M001/);
});
```

- [ ] **Step 2: Update workflow-kernel sidecar test first**

Modify `src/resources/extensions/gsd/tests/workflow-kernel.test.ts` in `decideDispatchNodeKind maps sidecar kinds before unit types`:

```ts
  assert.equal(decideDispatchNodeKind("retrospect-milestone", "retrospective"), "verification");
```

- [ ] **Step 3: Run trigger tests and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-trigger.test.ts src/resources/extensions/gsd/tests/workflow-kernel.test.ts
```

Expected: FAIL because the trigger module and sidecar kind do not exist.

- [ ] **Step 4: Implement retrospective trigger helpers**

Create `src/resources/extensions/gsd/retrospective-trigger.ts`:

```ts
// Project/App: gsd-pi
// File Purpose: Enqueues and persists milestone retrospective sidecar requests.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { gsdRoot } from "./paths.js";
import { buildRetrospectMilestonePrompt } from "./auto-prompts.js";
import type { SidecarItem } from "./auto/session.js";
import type { RetrospectiveOutcome } from "./retrospective-types.js";

export interface PendingRetrospective {
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
}

const PENDING_FILE = "pending-retrospectives.json";

function pendingPath(basePath: string): string {
  return join(gsdRoot(basePath), "runtime", PENDING_FILE);
}

function keyOf(entry: PendingRetrospective): string {
  return [entry.milestoneId, entry.outcome, entry.reason ?? ""].join("\0");
}

export function classifyRetrospectiveOutcomeFromStopReason(reason: string | undefined): RetrospectiveOutcome {
  const text = (reason ?? "").toLowerCase();
  if (/\b(stuck|already-active|timeout|loop|exhausted)\b/.test(text)) return "stuck";
  if (/\b(abort|cancel|user)\b/.test(text)) return "aborted";
  return "failed";
}

export function readPendingRetrospectives(basePath: string): PendingRetrospective[] {
  const file = pendingPath(basePath);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { pending?: PendingRetrospective[] };
    return Array.isArray(parsed.pending) ? parsed.pending : [];
  } catch {
    return [];
  }
}

export function recordPendingRetrospective(basePath: string, entry: PendingRetrospective): void {
  const existing = readPendingRetrospectives(basePath);
  const seen = new Set(existing.map(keyOf));
  if (!seen.has(keyOf(entry))) existing.push(entry);
  const file = pendingPath(basePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, pending: existing }, null, 2)}\n`, "utf8");
}

export function consumePendingRetrospectives(basePath: string): PendingRetrospective[] {
  const pending = readPendingRetrospectives(basePath);
  const file = pendingPath(basePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, pending: [] }, null, 2)}\n`, "utf8");
  return pending;
}

export async function buildRetrospectiveSidecar(
  basePath: string,
  entry: PendingRetrospective,
): Promise<SidecarItem> {
  return {
    kind: "retrospective",
    unitType: "retrospect-milestone",
    unitId: entry.milestoneId,
    prompt: await buildRetrospectMilestonePrompt(entry.milestoneId, basePath, entry.outcome, entry.reason),
    retrospectiveOutcome: entry.outcome,
    retrospectiveReason: entry.reason,
  };
}
```

- [ ] **Step 5: Add sidecar kind and scheduling classification**

Modify `src/resources/extensions/gsd/auto/session.ts` by adding a top-level type import:

```ts
import type { RetrospectiveOutcome } from "../retrospective-types.js";
```

Extend `CurrentUnit`:

```ts
  retrospectiveOutcome?: RetrospectiveOutcome;
  retrospectiveReason?: string;
```

Modify `SidecarItem`:

```ts
  kind: "hook" | "triage" | "quick-task" | "doctor-heal" | "retrospective";
  /** Retrospective run outcome, present only for retrospective sidecars. */
  retrospectiveOutcome?: RetrospectiveOutcome;
  /** Stop/pause/completion reason, present only for retrospective sidecars. */
  retrospectiveReason?: string;
```

Modify `decideDispatchNodeKind` in `src/resources/extensions/gsd/auto/workflow-kernel.ts`:

```ts
  if (sidecarKind === "retrospective") return "verification";
```

Modify the `s.currentUnit = ...` assignment in `runUnitPhase` in `src/resources/extensions/gsd/auto/phases.ts`:

```ts
  s.currentUnit = {
    type: unitType,
    id: unitId,
    startedAt: unitStartedAt,
    workspaceRoot: s.basePath,
    retrospectiveOutcome: sidecarItem?.retrospectiveOutcome,
    retrospectiveReason: sidecarItem?.retrospectiveReason,
  };
```

- [ ] **Step 6: Enqueue successful closeout retrospectives**

In `src/resources/extensions/gsd/auto-post-unit.ts`, import:

```ts
import { buildRetrospectiveSidecar } from "./retrospective-trigger.js";
```

In `postUnitPostVerification`, after post-unit hooks/retry handling and before capture triage, add:

```ts
  if (
    s.currentUnit &&
    s.currentUnit.type === "complete-milestone" &&
    !s.stepMode
  ) {
    const retroSidecar = await buildRetrospectiveSidecar(s.basePath, {
      milestoneId: s.currentUnit.id,
      outcome: "completed",
      reason: "complete-milestone settled",
    });
    return enqueueSidecar(
      s,
      ctx,
      retroSidecar,
      { milestoneId: s.currentUnit.id, outcome: "completed" },
      `Queued milestone retrospective for ${s.currentUnit.id}.`,
    );
  }
```

Also update `_shouldDispatchTriageForTest` so `retrospect-milestone` does not trigger captures triage:

```ts
    state.currentUnit.type !== "retrospect-milestone" &&
```

- [ ] **Step 7: Record pending terminal retrospectives**

In `src/resources/extensions/gsd/auto.ts`, import:

```ts
import {
  classifyRetrospectiveOutcomeFromStopReason,
  recordPendingRetrospective,
} from "./retrospective-trigger.js";
```

In `stopAuto`, after `loadedPreferences` is resolved and before clearing locks, add:

```ts
  try {
    if (loadedPreferences?.retrospective?.enabled && s.currentMilestoneId && !completionStopRequested) {
      recordPendingRetrospective(s.originalBasePath || s.basePath, {
        milestoneId: s.currentMilestoneId,
        outcome: classifyRetrospectiveOutcomeFromStopReason(reason),
        reason,
      });
    }
  } catch (err) {
    debugLog("stop-retrospective-pending-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
```

In `pauseAuto`, before `s.currentUnit = null`, add:

```ts
  try {
    const prefs = loadEffectiveGSDPreferences(s.basePath || undefined)?.preferences;
    if (prefs?.retrospective?.enabled && s.currentMilestoneId) {
      recordPendingRetrospective(s.originalBasePath || s.basePath, {
        milestoneId: s.currentMilestoneId,
        outcome: classifyRetrospectiveOutcomeFromStopReason(_errorContext?.message),
        reason: _errorContext?.message,
      });
    }
  } catch (err) {
    debugLog("pause-retrospective-pending-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
```

- [ ] **Step 8: Drain pending retrospectives before normal dispatch**

In `src/resources/extensions/gsd/auto/loop.ts`, import:

```ts
import { buildRetrospectiveSidecar, consumePendingRetrospectives } from "../retrospective-trigger.js";
```

After preferences are loaded and before `dequeueSidecarItem`, add:

```ts
      if (prefs?.retrospective?.enabled && s.sidecarQueue.length === 0) {
        const pendingRetrospectives = consumePendingRetrospectives(s.canonicalProjectRoot);
        for (const pending of pendingRetrospectives) {
          s.sidecarQueue.push(await buildRetrospectiveSidecar(s.canonicalProjectRoot, pending));
        }
      }
```

- [ ] **Step 9: Run trigger tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-trigger.test.ts src/resources/extensions/gsd/tests/workflow-kernel.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add src/resources/extensions/gsd/retrospective-trigger.ts src/resources/extensions/gsd/tests/retrospective-trigger.test.ts src/resources/extensions/gsd/auto/session.ts src/resources/extensions/gsd/auto/phases.ts src/resources/extensions/gsd/auto/workflow-kernel.ts src/resources/extensions/gsd/tests/workflow-kernel.test.ts src/resources/extensions/gsd/auto-post-unit.ts src/resources/extensions/gsd/auto.ts src/resources/extensions/gsd/auto/loop.ts
git commit -m "feat(gsd): trigger milestone retrospective sidecar"
```

---

## Task 6: Finalize Retrospective Issues After Unit Completion

**Files:**
- Modify: `src/resources/extensions/gsd/retrospective-github.ts`
- Modify: `src/resources/extensions/gsd/tests/retrospective-github.test.ts`
- Modify: `src/resources/extensions/gsd/auto-post-unit.ts`

- [ ] **Step 1: Add failing issue-finalization test**

Append to `src/resources/extensions/gsd/tests/retrospective-github.test.ts`:

```ts
test("fileRetrospectiveIssues records pending payload when createIssue fails", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-retro-file-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

  const result = await fileRetrospectiveIssues({
    basePath: base,
    milestoneId: "M001",
    outcome: "completed",
    config: {
      enabled: true,
      issueRepo: "skspade/gsd-pi",
      issueLabel: "gsd-auto-retro",
      maxIssuesPerRun: 10,
    },
    findings: [finding()],
    createIssue: () => ({ ok: false, error: "gh not authenticated" }),
    ensureLabel: () => ({ ok: false, error: "label unavailable" }),
    listIssuesByLabel: () => ({ ok: true, data: [] }),
  });

  assert.equal(result.created, 0);
  assert.equal(result.pending, 1);
  const map = readIssueMap(join(base, ".gsd", "milestones", "M001", "M001-RETRO-ISSUES.json"));
  assert.equal(map?.records[0]?.status, "pending");
  assert.match(map?.records[0]?.body ?? "", /Prompt confused two route owners/);
});
```

Add imports:

```ts
import { readIssueMap } from "../retrospective-artifacts.ts";
import { fileRetrospectiveIssues } from "../retrospective-github.ts";
```

- [ ] **Step 2: Run finalization test and verify failure**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-github.test.ts
```

Expected: FAIL because `fileRetrospectiveIssues` does not exist.

- [ ] **Step 3: Implement side-effecting filing**

Modify `src/resources/extensions/gsd/retrospective-github.ts`:

```ts
import { relative } from "node:path";

import {
  readIssueMap,
  resolveRetrospectivePaths,
  writeIssueMap,
} from "./retrospective-artifacts.js";
import {
  ghCreateIssue,
  ghEnsureLabel,
  ghListIssuesByLabel,
  type GhResult,
  type ListedIssue,
} from "../github-sync/cli.js";
import type { RetrospectiveIssueMap, RetrospectiveIssueRecord } from "./retrospective-types.js";
```

Add:

```ts
export interface FileRetrospectiveIssuesDeps {
  createIssue?: typeof ghCreateIssue;
  ensureLabel?: typeof ghEnsureLabel;
  listIssuesByLabel?: typeof ghListIssuesByLabel;
}

export interface FileRetrospectiveIssuesInput extends FileRetrospectiveIssuesDeps {
  basePath: string;
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
  config: Extract<RetrospectiveFilingConfig, { enabled: true }>;
  findings: RetrospectiveFinding[];
}

export interface FileRetrospectiveIssuesResult {
  created: number;
  pending: number;
  skipped: number;
}

function existingFingerprintsFromIssues(result: GhResult<ListedIssue[]>): Set<string> {
  const values = new Set<string>();
  if (!result.ok) return values;
  for (const issue of result.data ?? []) {
    const haystack = `${issue.title}\n${issue.body ?? ""}`;
    for (const match of haystack.matchAll(/\bFingerprint:\s*`?([a-f0-9]{64})`?/gi)) {
      values.add(match[1]!.toLowerCase());
    }
  }
  return values;
}

export async function fileRetrospectiveIssues(
  input: FileRetrospectiveIssuesInput,
): Promise<FileRetrospectiveIssuesResult> {
  const paths = resolveRetrospectivePaths(input.basePath, input.milestoneId);
  const existingMap = readIssueMap(paths.issueMap);
  const records = existingMap?.records ?? [];
  const existingFingerprints = new Set(records.map((record) => record.fingerprint));

  const listIssuesByLabel = input.listIssuesByLabel ?? ghListIssuesByLabel;
  const remoteIssues = listIssuesByLabel(input.basePath, input.config.issueRepo, input.config.issueLabel, 100);
  for (const fingerprint of existingFingerprintsFromIssues(remoteIssues)) {
    existingFingerprints.add(fingerprint);
  }

  const planned = planRetrospectiveIssueFiling({
    findings: input.findings,
    existingFingerprints,
    maxIssues: input.config.maxIssuesPerRun,
  });

  const ensureLabel = input.ensureLabel ?? ghEnsureLabel;
  ensureLabel(input.basePath, input.config.issueRepo, input.config.issueLabel);

  const createIssue = input.createIssue ?? ghCreateIssue;
  let created = 0;
  let pending = 0;
  const skipped = input.findings.length - planned.length;
  const nextRecords: RetrospectiveIssueRecord[] = [...records];

  for (const finding of planned) {
    const body = buildRetrospectiveIssueBody({
      basePath: input.basePath,
      milestoneId: input.milestoneId,
      outcome: input.outcome,
      reason: input.reason,
      finding,
      retroPath: relative(input.basePath, paths.retro),
    });
    const issueResult = createIssue(input.basePath, {
      repo: input.config.issueRepo,
      title: buildRetrospectiveIssueTitle(finding),
      body,
      labels: [input.config.issueLabel],
    });
    const updatedAt = new Date().toISOString();
    if (issueResult.ok) {
      created++;
      nextRecords.push({
        fingerprint: finding.fingerprint,
        title: finding.title,
        category: finding.category,
        status: "created",
        issueNumber: issueResult.data,
        issueUrl: `https://github.com/${input.config.issueRepo}/issues/${issueResult.data}`,
        updatedAt,
      });
    } else {
      pending++;
      nextRecords.push({
        fingerprint: finding.fingerprint,
        title: finding.title,
        category: finding.category,
        status: "pending",
        error: issueResult.error,
        body,
        updatedAt,
      });
    }
  }

  const map: RetrospectiveIssueMap = {
    version: 1,
    milestoneId: input.milestoneId,
    issueRepo: input.config.issueRepo,
    issueLabel: input.config.issueLabel,
    records: nextRecords,
  };
  writeIssueMap(paths.issueMap, map);
  return { created, pending, skipped };
}
```

- [ ] **Step 4: Finalize retrospective unit in post-unit pipeline**

In `src/resources/extensions/gsd/auto-post-unit.ts`, import:

```ts
import { parseRetrospectiveMarkdown, resolveRetrospectivePaths } from "./retrospective-artifacts.js";
import {
  fileRetrospectiveIssues,
  resolveRetrospectiveFilingConfig,
} from "./retrospective-github.js";
import { loadFile } from "./files.js";
```

`loadFile` may already be imported in this file; if so, reuse the existing import instead of duplicating it.

At the beginning of `postUnitPostVerification`, after the codebase refresh block and before post-unit hooks, add:

```ts
  if (s.currentUnit?.type === "retrospect-milestone") {
    const paths = resolveRetrospectivePaths(s.basePath, s.currentUnit.id);
    const content = await loadFile(paths.retro);
    const parsed = content ? parseRetrospectiveMarkdown(content) : { ok: false, findings: [], error: "missing RETRO artifact" };
    const prefs = loadEffectiveGSDPreferences(s.basePath)?.preferences;
    const config = resolveRetrospectiveFilingConfig(prefs?.retrospective);
    if (!parsed.ok) {
      ctx.ui.notify(`Milestone retrospective skipped issue filing: ${parsed.error}`, "warning");
      return "continue";
    }
    if (!config.enabled) {
      ctx.ui.notify(`Milestone retrospective skipped issue filing: ${config.reason}`, "info");
      return "continue";
    }
    const result = await fileRetrospectiveIssues({
      basePath: s.basePath,
      milestoneId: s.currentUnit.id,
      outcome: s.currentUnit.retrospectiveOutcome ?? "completed",
      reason: s.currentUnit.retrospectiveReason,
      config,
      findings: parsed.findings,
    });
    ctx.ui.notify(
      `Milestone retrospective filed ${result.created} issue(s), left ${result.pending} pending, skipped ${result.skipped}.`,
      "info",
    );
    return "continue";
  }
```

- [ ] **Step 5: Run retrospective GitHub tests and verify pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/retrospective-github.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/resources/extensions/gsd/retrospective-github.ts src/resources/extensions/gsd/tests/retrospective-github.test.ts src/resources/extensions/gsd/auto-post-unit.ts
git commit -m "feat(gsd): file retrospective issues after closeout"
```

---

## Task 7: Preferences Documentation And Final Verification

**Files:**
- Modify: `src/resources/extensions/gsd/templates/PREFERENCES.md`
- Modify: `src/resources/extensions/gsd/docs/preferences-reference.md`
- Modify: `docs/prompt-map.md`

- [ ] **Step 1: Document default preferences**

Add this to `src/resources/extensions/gsd/templates/PREFERENCES.md` near the GitHub and forensics preferences:

```yaml
retrospective:
  enabled: false
  issue_repo: skspade/gsd-pi
  issue_label: gsd-auto-retro
  max_issues_per_run: 10
```

- [ ] **Step 2: Document preference reference**

Add to `src/resources/extensions/gsd/docs/preferences-reference.md` near `forensics_dedup`:

```md
- `retrospective`: object — milestone retrospective automation. Disabled by default.
  - `enabled`: boolean — run the retrospective agent and file issues when configured. Default: `false`.
  - `issue_repo`: string — personal fork target for auto-created issues. Must be `skspade/gsd-pi`; `open-gsd/gsd-pi` is rejected.
  - `issue_label`: string — primary label applied to auto-created issues. Default: `gsd-auto-retro`.
  - `max_issues_per_run`: number — maximum issues to create from one retrospective run. Default: `10`.
```

- [ ] **Step 3: Update prompt map**

In `docs/prompt-map.md`, add `retrospect-milestone` to Completion Flow after `complete-milestone`:

```md
complete-milestone
         │
         ▼
retrospect-milestone  (best-effort auto-retro issue filing)
```

Add the prompt row:

```md
| `retrospect-milestone.md` | Analyze milestone run friction and write `M##-RETRO.md`; deterministic TypeScript files one labeled issue per finding. | writes `M##-RETRO.md`, then GitHub filing code |
```

Add the artifact mapping:

```md
retrospect-milestone        →  .gsd/milestones/M##/M##-RETRO.md
                                 .gsd/milestones/M##/M##-RETRO-ISSUES.json
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/preferences.test.ts \
  src/resources/extensions/gsd/tests/retrospective-artifacts.test.ts \
  src/resources/extensions/gsd/tests/retrospective-redaction.test.ts \
  src/resources/extensions/gsd/tests/retrospective-context.test.ts \
  src/resources/extensions/gsd/tests/retrospective-github.test.ts \
  src/resources/extensions/gsd/tests/retrospective-trigger.test.ts \
  src/resources/extensions/gsd/tests/workflow-kernel.test.ts \
  src/resources/extensions/gsd/tests/auto-artifact-paths.test.ts \
  src/resources/extensions/github-sync/tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full unit verification**

Run:

```bash
pnpm run test:unit
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/resources/extensions/gsd/templates/PREFERENCES.md src/resources/extensions/gsd/docs/preferences-reference.md docs/prompt-map.md
git commit -m "docs(gsd): document milestone retrospective agent"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: clean working tree.
