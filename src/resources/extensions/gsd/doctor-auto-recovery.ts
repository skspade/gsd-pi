// Project/App: gsd-pi
// File Purpose: Auto-mode doctor recovery decisions for health-gate trouble.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SidecarItem } from "./auto/session.js";
import type { DoctorIssue, DoctorReport } from "./doctor-types.js";
import {
  filterDoctorIssues,
  formatDoctorIssuesForPrompt,
  formatDoctorReport,
} from "./doctor-format.js";
import {
  buildDoctorHealIssuePayload,
  buildDoctorHealSummary,
} from "./workflow-protocol.js";

const DEFAULT_TRIGGER_ISSUES_CHARS = 1_200;

export interface DoctorRunOptions {
  fix: true;
  scope?: string;
  fixLevel: "task";
}

export type DoctorTroubleRecoveryResult =
  | {
      action: "proceed";
      fixesApplied: string[];
      scope?: string;
    }
  | {
      action: "doctor-heal";
      fixesApplied: string[];
      issueCount: number;
      scope?: string;
      sidecar: SidecarItem;
    }
  | {
      action: "pause";
      fixesApplied: string[];
      scope?: string;
      reason: string;
    };

export interface DoctorTroubleRecoveryInput {
  basePath: string;
  triggerIssues: string[];
  runDoctor?: (basePath: string, options: DoctorRunOptions) => Promise<DoctorReport>;
  selectScope?: (basePath: string) => Promise<string | undefined>;
}

async function defaultSelectScope(basePath: string): Promise<string | undefined> {
  const mod = await import("./doctor.js");
  return mod.selectDoctorScope(basePath);
}

async function defaultRunDoctor(basePath: string, options: DoctorRunOptions): Promise<DoctorReport> {
  const mod = await import("./doctor.js");
  return mod.runGSDDoctor(basePath, options);
}

export function isDoctorAutoRecoveryActionable(issue: DoctorIssue): boolean {
  return issue.fixable && issue.severity !== "info";
}

export function buildDoctorHealSidecarPrompt(options: {
  scope?: string;
  reportText: string;
  structuredIssues: string;
  triggerIssues: string[];
}): string {
  const promptPath = join(dirname(fileURLToPath(import.meta.url)), "prompts", "doctor-heal.md");
  let prompt = readFileSync(promptPath, "utf-8");
  const vars: Record<string, string> = {
    doctorSummary: buildDoctorHealSummary(options.reportText),
    triggerIssues: formatTriggerIssues(options.triggerIssues),
    structuredIssues: buildDoctorHealIssuePayload(options.structuredIssues),
    scopeLabel: options.scope ?? "active milestone / blocking scope",
    doctorCommandSuffix: options.scope ? ` ${options.scope}` : "",
  };
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.split(`{{${key}}}`).join(value);
  }
  return prompt.trim();
}

function formatTriggerIssues(triggerIssues: string[]): string {
  if (triggerIssues.length === 0) return "No auto-mode trigger issues were provided.";
  const text = triggerIssues.map((issue) => `- ${issue}`).join("\n");
  if (text.length <= DEFAULT_TRIGGER_ISSUES_CHARS) return text;
  const suffix = "\n\n[Truncated]\nAuto-mode trigger list was capped; use the structured doctor issues for repairs.";
  return `${text.slice(0, DEFAULT_TRIGGER_ISSUES_CHARS - suffix.length).trimEnd()}${suffix}`;
}

function buildDoctorPauseReason(report: DoctorReport, scope: string | undefined): string {
  const reportText = formatDoctorReport(report, {
    scope,
    includeWarnings: true,
    maxIssues: 8,
    title: "Auto-mode doctor recovery could not clear blocking issues.",
  });
  return `${reportText}\nRun /gsd doctor heal${scope ? ` ${scope}` : ""} or fix the listed issue(s), then resume auto-mode.`;
}

export async function resolveDoctorTroubleRecovery(
  input: DoctorTroubleRecoveryInput,
): Promise<DoctorTroubleRecoveryResult> {
  const selectScope = input.selectScope ?? defaultSelectScope;
  const runDoctor = input.runDoctor ?? defaultRunDoctor;
  const scope = await selectScope(input.basePath);
  const report = await runDoctor(input.basePath, {
    fix: true,
    scope,
    fixLevel: "task",
  });
  const fixesApplied = [...report.fixesApplied];

  if (report.ok) {
    return { action: "proceed", fixesApplied, scope };
  }

  const scopedIssues = filterDoctorIssues(report.issues, {
    scope,
    includeWarnings: true,
  });
  const actionable = scopedIssues.filter(isDoctorAutoRecoveryActionable);
  if (actionable.length > 0) {
    const reportText = formatDoctorReport(report, {
      scope,
      includeWarnings: true,
      maxIssues: 12,
      title: "GSD doctor heal prep.",
    });
    const structuredIssues = formatDoctorIssuesForPrompt(actionable);
    return {
      action: "doctor-heal",
      fixesApplied,
      issueCount: actionable.length,
      scope,
      sidecar: {
        kind: "doctor-heal",
        unitType: "doctor-heal",
        unitId: scope ?? "project",
        prompt: buildDoctorHealSidecarPrompt({
          scope,
          reportText,
          structuredIssues,
          triggerIssues: input.triggerIssues,
        }),
      },
    };
  }

  return {
    action: "pause",
    fixesApplied,
    scope,
    reason: buildDoctorPauseReason(report, scope),
  };
}
