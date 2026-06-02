import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { diagnoseExpectedArtifact, resolveExpectedArtifactPath } from "../auto-artifact-paths.ts";
import { clearPathCache, _clearGsdRootCache } from "../paths.ts";

test("worktree artifact resolution falls back to project .gsd artifacts", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gsd-auto-artifact-")));
  try {
    const projectGsd = join(root, ".gsd");
    const wtRoot = join(projectGsd, "worktrees", "M001");
    const wtGsd = join(wtRoot, ".gsd");
    const projectMilestoneDir = join(projectGsd, "milestones", "M001");
    const projectSliceDir = join(projectMilestoneDir, "slices", "S01");

    mkdirSync(projectSliceDir, { recursive: true });
    mkdirSync(wtGsd, { recursive: true });
    writeFileSync(join(projectMilestoneDir, "M001-ROADMAP.md"), "# roadmap\n");
    writeFileSync(join(projectSliceDir, "S01-PLAN.md"), "# plan\n");

    _clearGsdRootCache();
    clearPathCache();

    assert.equal(
      resolveExpectedArtifactPath("plan-milestone", "M001", wtRoot),
      join(projectMilestoneDir, "M001-ROADMAP.md"),
    );
    assert.equal(
      resolveExpectedArtifactPath("plan-slice", "M001/S01", wtRoot),
      join(projectSliceDir, "S01-PLAN.md"),
    );
  } finally {
    _clearGsdRootCache();
    clearPathCache();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retrospect-milestone resolves to the milestone RETRO artifact", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gsd-auto-artifact-")));
  try {
    const base = root;
    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    mkdirSync(milestoneDir, { recursive: true });

    _clearGsdRootCache();
    clearPathCache();

    assert.equal(
      resolveExpectedArtifactPath("retrospect-milestone", "M001", base),
      join(milestoneDir, "M001-RETRO.md"),
    );
    assert.match(
      diagnoseExpectedArtifact("retrospect-milestone", "M001", base) ?? "",
      /milestone retrospective with fenced JSON findings/,
    );
  } finally {
    _clearGsdRootCache();
    clearPathCache();
    rmSync(root, { recursive: true, force: true });
  }
});
