import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { clearPathCache, _clearGsdRootCache } from "../paths.ts";

const previousGsdHome = process.env.GSD_HOME;
const testGsdHome = mkdtempSync(join(tmpdir(), "gsd-retro-trigger-home-"));
process.env.GSD_HOME = testGsdHome;
process.once("exit", () => {
  if (previousGsdHome === undefined) delete process.env.GSD_HOME;
  else process.env.GSD_HOME = previousGsdHome;
  rmSync(testGsdHome, { recursive: true, force: true });
});

async function loadTriggerModule() {
  return import(`../retrospective-trigger.ts?test=${Date.now()}`);
}

async function loadPostUnitModule() {
  return import(`../auto-post-unit.ts?test=${Date.now()}`);
}

function makeTempBase(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "gsd-retro-trigger-")));
}

function cleanup(path: string): void {
  _clearGsdRootCache();
  clearPathCache();
  rmSync(path, { recursive: true, force: true });
}

test("classifyRetrospectiveOutcomeFromStopReason maps terminal reasons", async () => {
  const { classifyRetrospectiveOutcomeFromStopReason } = await loadTriggerModule();
  for (const reason of [
    "stuck detector stopped the loop",
    "already-active dispatch claim",
    "session-timeout",
    "max-iterations loop exhausted",
    "verification exhausted",
  ]) {
    assert.equal(classifyRetrospectiveOutcomeFromStopReason(reason), "stuck");
  }

  for (const reason of [
    "abort requested",
    "cancelled by signal",
    "user pause",
  ]) {
    assert.equal(classifyRetrospectiveOutcomeFromStopReason(reason), "aborted");
  }

  assert.equal(classifyRetrospectiveOutcomeFromStopReason("git closeout failed"), "failed");
  assert.equal(classifyRetrospectiveOutcomeFromStopReason(undefined), "failed");
});

test("pending retrospectives persist idempotently and consume clears them", async () => {
  const {
    consumePendingRetrospectives,
    readPendingRetrospectives,
    recordPendingRetrospective,
  } = await loadTriggerModule();
  const base = makeTempBase();
  try {
    const entry = { milestoneId: "M001", outcome: "stuck" as const, reason: "unit-hard-timeout" };

    recordPendingRetrospective(base, entry);
    recordPendingRetrospective(base, entry);
    recordPendingRetrospective(base, { ...entry, reason: "already-active" });

    assert.deepEqual(readPendingRetrospectives(base), [
      entry,
      { milestoneId: "M001", outcome: "stuck", reason: "already-active" },
    ]);

    assert.deepEqual(consumePendingRetrospectives(base), [
      entry,
      { milestoneId: "M001", outcome: "stuck", reason: "already-active" },
    ]);
    assert.deepEqual(readPendingRetrospectives(base), []);
    assert.equal(existsSync(join(base, ".gsd", "runtime", "pending-retrospectives.json")), false);
  } finally {
    cleanup(base);
  }
});

test("removePendingRetrospective clears only the completed matching entry", async () => {
  const {
    readPendingRetrospectives,
    recordPendingRetrospective,
    removePendingRetrospective,
  } = await loadTriggerModule();
  const base = makeTempBase();
  try {
    const first = { milestoneId: "M001", outcome: "stuck" as const, reason: "unit-hard-timeout" };
    const second = { milestoneId: "M001", outcome: "failed" as const, reason: "git closeout failed" };

    recordPendingRetrospective(base, first);
    recordPendingRetrospective(base, second);
    removePendingRetrospective(base, first);

    assert.deepEqual(readPendingRetrospectives(base), [second]);
    assert.equal(existsSync(join(base, ".gsd", "runtime", "pending-retrospectives.json")), true);

    removePendingRetrospective(base, second);
    assert.deepEqual(readPendingRetrospectives(base), []);
    assert.equal(existsSync(join(base, ".gsd", "runtime", "pending-retrospectives.json")), false);
  } finally {
    cleanup(base);
  }
});

test("pending retrospective removal requires a verified RETRO artifact", async () => {
  const { _shouldRemovePendingRetrospectiveForTest } = await loadPostUnitModule();
  const base = makeTempBase();
  try {
    const unit = {
      type: "retrospect-milestone",
      id: "M001",
      startedAt: 1,
      workspaceRoot: base,
      retrospectiveOutcome: "stuck",
    };

    assert.equal(_shouldRemovePendingRetrospectiveForTest(unit, base), false);

    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    mkdirSync(milestoneDir, { recursive: true });
    writeFileSync(join(milestoneDir, "M001-RETRO.md"), "# Retrospective\n", "utf-8");

    assert.equal(_shouldRemovePendingRetrospectiveForTest(unit, base), true);
  } finally {
    cleanup(base);
  }
});

test("pending retrospective removal waits for issue filing to have no pending records", async () => {
  const { _shouldRemovePendingRetrospectiveAfterFilingForTest } = await loadPostUnitModule();
  const base = makeTempBase();
  try {
    const unit = {
      type: "retrospect-milestone",
      id: "M001",
      startedAt: 1,
      workspaceRoot: base,
      retrospectiveOutcome: "stuck",
    };
    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    mkdirSync(milestoneDir, { recursive: true });
    writeFileSync(join(milestoneDir, "M001-RETRO.md"), "# Retrospective\n", "utf-8");

    assert.equal(
      _shouldRemovePendingRetrospectiveAfterFilingForTest(unit, base, { pending: 1 }),
      false,
    );
    assert.equal(
      _shouldRemovePendingRetrospectiveAfterFilingForTest(unit, base, { pending: 0 }),
      true,
    );
  } finally {
    cleanup(base);
  }
});

test("buildRetrospectiveSidecar returns retrospective sidecar with prompt context", async () => {
  const { buildRetrospectiveSidecar } = await loadTriggerModule();
  const base = makeTempBase();
  try {
    const sidecar = await buildRetrospectiveSidecar(base, {
      milestoneId: "M002",
      outcome: "failed",
      reason: "git closeout failed",
    });

    assert.equal(sidecar.kind, "retrospective");
    assert.equal(sidecar.unitType, "retrospect-milestone");
    assert.equal(sidecar.unitId, "M002");
    assert.equal(sidecar.retrospectiveOutcome, "failed");
    assert.equal(sidecar.retrospectiveReason, "git closeout failed");
    assert.match(sidecar.prompt, /M002/);
    assert.match(sidecar.prompt, /Outcome: failed/);
    assert.match(sidecar.prompt, /Reason: git closeout failed/);
  } finally {
    cleanup(base);
  }
});
