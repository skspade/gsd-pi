import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ensureDbOpen } from "../bootstrap/dynamic-tools.ts";
import {
  closeDatabase,
  getAllMilestones,
  getSliceTasks,
  insertMilestone,
  insertSlice,
} from "../gsd-db.ts";
import { runCreateMilestoneRecoveryPreflight } from "../guided-flow.ts";
import { writeGSDDirectory } from "../migrate/writer.ts";
import type { GSDProject } from "../migrate/types.ts";

function makeBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-create-milestone-preflight-"));
}

function cleanup(base: string): void {
  closeDatabase();
  rmSync(base, { recursive: true, force: true });
}

function mkCtx(notifications: Array<{ message: string; level: string }>): any {
  return {
    ui: {
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  };
}

function projectFixture(): GSDProject {
  return {
    projectContent: "# Existing Project\n",
    decisionsContent: "",
    requirements: [],
    milestones: [
      {
        id: "M001",
        title: "Existing Milestone",
        vision: "Existing markdown work",
        successCriteria: ["Existing work is available"],
        research: null,
        boundaryMap: [],
        slices: [
          {
            id: "S01",
            title: "Existing Slice",
            risk: "medium",
            depends: [],
            done: false,
            demo: "Existing slice demo",
            goal: "Existing slice demo",
            research: null,
            summary: null,
            tasks: [
              {
                id: "T01",
                title: "Existing Task",
                description: "Existing task",
                done: false,
                estimate: "",
                files: ["src/index.ts"],
                mustHaves: [],
                summary: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

test("create milestone preflight recovers existing markdown when DB hierarchy is empty", async () => {
  const base = makeBase();
  const notifications: Array<{ message: string; level: string }> = [];
  try {
    await writeGSDDirectory(projectFixture(), base);
    assert.equal(await ensureDbOpen(base), true);
    assert.equal(getAllMilestones().length, 0);

    const shouldContinue = await runCreateMilestoneRecoveryPreflight(mkCtx(notifications), base);

    assert.equal(shouldContinue, true);
    assert.equal(getAllMilestones().length, 1);
    assert.equal(getSliceTasks("M001", "S01").length, 1);
    assert.ok(
      notifications.some((n) => n.level === "success" && /Recovered GSD database/.test(n.message)),
      "preflight should report the deterministic recovery before milestone creation continues",
    );
  } finally {
    cleanup(base);
  }
});

test("create milestone preflight blocks partial DB mismatch for explicit recovery", async () => {
  const base = makeBase();
  const notifications: Array<{ message: string; level: string }> = [];
  try {
    await writeGSDDirectory(projectFixture(), base);
    assert.equal(await ensureDbOpen(base), true);
    insertMilestone({ id: "M001", title: "Existing Milestone", status: "active" });
    insertSlice({ id: "S01", milestoneId: "M001", title: "Existing Slice", status: "pending", risk: "medium", depends: [], demo: "Existing slice demo", sequence: 1 });

    const shouldContinue = await runCreateMilestoneRecoveryPreflight(mkCtx(notifications), base);

    assert.equal(shouldContinue, false);
    assert.equal(getAllMilestones().length, 1);
    assert.equal(getSliceTasks("M001", "S01").length, 0);
    assert.ok(
      notifications.some((n) => n.level === "warning" && /\/gsd recover/.test(n.message)),
      "preflight should leave partial mismatches for explicit recovery",
    );
  } finally {
    cleanup(base);
  }
});
