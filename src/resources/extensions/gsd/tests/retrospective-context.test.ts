import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildRetrospectiveContext } from "../retrospective-context.ts";
import { clearPathCache, _clearGsdRootCache } from "../paths.ts";

function makeTempBase(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "gsd-retro-context-")));
}

function cleanup(path: string): void {
  _clearGsdRootCache();
  clearPathCache();
  rmSync(path, { recursive: true, force: true });
}

test("buildRetrospectiveContext includes outcome, reason, milestone artifacts, target path, and activity logs", async () => {
  const base = makeTempBase();
  try {
    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    const activityDir = join(base, ".gsd", "activity");
    mkdirSync(milestoneDir, { recursive: true });
    mkdirSync(activityDir, { recursive: true });
    writeFileSync(join(milestoneDir, "M001-ROADMAP.md"), "# Roadmap\n\nship the route owner check\n", "utf-8");
    writeFileSync(join(milestoneDir, "M001-SUMMARY.md"), "# Summary\n\nroute owner check shipped\n", "utf-8");
    writeFileSync(join(milestoneDir, "M001-VALIDATION.md"), "# Validation\n\nverdict: pass\n", "utf-8");
    writeFileSync(join(milestoneDir, "M001-LEARNINGS.md"), "# Learnings\n\ncheck routes first\n", "utf-8");
    writeFileSync(
      join(activityDir, "001-complete-milestone-M001.jsonl"),
      `${JSON.stringify({ event: "complete-milestone", milestoneId: "M001" })}\n`,
      "utf-8",
    );
    writeFileSync(
      join(activityDir, "002-execute-task-M999-S01-T01.jsonl"),
      `${JSON.stringify({ event: "other milestone" })}\n`,
      "utf-8",
    );

    _clearGsdRootCache();
    clearPathCache();

    const context = await buildRetrospectiveContext("M001", base, "failed", "validation flaked");

    assert.match(context, /Milestone ID: M001/);
    assert.match(context, /Outcome: failed/);
    assert.match(context, /Reason: validation flaked/);
    assert.match(context, /\.gsd\/milestones\/M001\/M001-RETRO\.md/);
    assert.match(context, /ship the route owner check/);
    assert.match(context, /route owner check shipped/);
    assert.match(context, /verdict: pass/);
    assert.match(context, /check routes first/);
    assert.match(context, /complete-milestone/);
    assert.doesNotMatch(context, /other milestone/);
  } finally {
    cleanup(base);
  }
});

test("buildRetrospectiveContext bounds milestone artifact content", async () => {
  const base = makeTempBase();
  try {
    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    mkdirSync(milestoneDir, { recursive: true });
    writeFileSync(
      join(milestoneDir, "M001-ROADMAP.md"),
      `# Roadmap\n\n${"A".repeat(30_000)}\nTAIL_SHOULD_NOT_APPEAR\n`,
      "utf-8",
    );

    _clearGsdRootCache();
    clearPathCache();

    const context = await buildRetrospectiveContext("M001", base, "completed");

    assert.match(context, /# Roadmap/);
    assert.match(context, /\[truncated/);
    assert.doesNotMatch(context, /TAIL_SHOULD_NOT_APPEAR/);
  } finally {
    cleanup(base);
  }
});

test("buildRetrospectiveContext uses adaptive fences around fenced artifact content", async () => {
  const base = makeTempBase();
  try {
    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    mkdirSync(milestoneDir, { recursive: true });
    writeFileSync(
      join(milestoneDir, "M001-ROADMAP.md"),
      ["# Roadmap", "", "```ts", "console.log('inside artifact');", "```"].join("\n"),
      "utf-8",
    );

    _clearGsdRootCache();
    clearPathCache();

    const context = await buildRetrospectiveContext("M001", base, "completed");

    assert.match(context, /````markdown/);
    assert.match(context, /```ts/);
    assert.match(context, /console\.log\('inside artifact'\);/);
  } finally {
    cleanup(base);
  }
});
