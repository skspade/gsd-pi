import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  gsdRoot,
  relMilestoneFile,
  resolveMilestoneFile,
} from "./paths.js";
import type { RetrospectiveOutcome } from "./retrospective-types.js";

const ARTIFACT_READ_LIMIT = 12_000;
const ACTIVITY_READ_LIMIT = 6_000;
const MAX_ACTIVITY_LOGS = 5;

interface ContextArtifact {
  label: string;
  suffix: string;
}

const MILESTONE_ARTIFACTS: ContextArtifact[] = [
  { label: "Roadmap", suffix: "ROADMAP" },
  { label: "Summary", suffix: "SUMMARY" },
  { label: "Validation", suffix: "VALIDATION" },
  { label: "Learnings", suffix: "LEARNINGS" },
];

export async function buildRetrospectiveContext(
  milestoneId: string,
  basePath: string,
  outcome: RetrospectiveOutcome,
  reason?: string,
): Promise<string> {
  const targetRel = relMilestoneFile(basePath, milestoneId, "RETRO");
  const targetAbs = join(basePath, targetRel);
  const parts = [
    "## Retrospective Context",
    "",
    `- Milestone ID: ${milestoneId}`,
    `- Outcome: ${outcome}`,
    `- Reason: ${reason?.trim() || "(none provided)"}`,
    `- Retrospective target path: ${targetRel}`,
    `- Retrospective absolute path: ${targetAbs}`,
    "",
    "## Milestone Artifacts",
    "",
    ...MILESTONE_ARTIFACTS.map((artifact) => formatMilestoneArtifact(basePath, milestoneId, artifact)),
    "",
    "## Activity Logs",
    "",
    formatActivityLogs(basePath, milestoneId),
  ];

  return parts.join("\n");
}

function formatMilestoneArtifact(basePath: string, milestoneId: string, artifact: ContextArtifact): string {
  const rel = relMilestoneFile(basePath, milestoneId, artifact.suffix);
  const path = resolveMilestoneFile(basePath, milestoneId, artifact.suffix);
  if (!path) {
    return [`### ${artifact.label}`, `Source: \`${rel}\``, "", "(missing)", ""].join("\n");
  }

 return [
    `### ${artifact.label}`,
    `Source: \`${rel}\``,
    "",
    fencedBlock("markdown", readBoundedFile(path, ARTIFACT_READ_LIMIT)),
    "",
  ].join("\n");
}

function formatActivityLogs(basePath: string, milestoneId: string): string {
  const activityDir = join(gsdRoot(basePath), "activity");
  if (!existsSync(activityDir)) return "(no activity logs found)";

  const logs = readdirSync(activityDir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => join(activityDir, file))
    .filter((path) => activityLogMatches(path, milestoneId))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, MAX_ACTIVITY_LOGS);

  if (logs.length === 0) return "(no milestone activity logs found)";

  return logs.map((path) => {
    const rel = path.startsWith(gsdRoot(basePath))
      ? `.gsd/${path.slice(gsdRoot(basePath).length).replace(/^\/+/, "")}`
      : path;
    return [
      `### ${rel}`,
      "",
      fencedBlock("jsonl", readBoundedFile(path, ACTIVITY_READ_LIMIT)),
    ].join("\n");
  }).join("\n\n");
}

function activityLogMatches(path: string, milestoneId: string): boolean {
  if (path.includes(milestoneId)) return true;
  return readBoundedFile(path, ACTIVITY_READ_LIMIT).includes(milestoneId);
}

function readBoundedFile(path: string, limit: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const truncated = bytesRead > limit;
    const content = buffer.subarray(0, Math.min(bytesRead, limit)).toString("utf-8").trimEnd();
    return truncated
      ? `${content}\n\n[truncated after ${limit} bytes]`
      : content;
  } finally {
    closeSync(fd);
  }
}

function fencedBlock(language: string, content: string): string {
  const longestFence = Math.max(
    2,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return [fence + language, content, fence].join("\n");
}
