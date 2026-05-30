import assert from "node:assert/strict";
import test from "node:test";

import type { DoctorReport } from "../doctor-types.ts";
import { resolveDoctorTroubleRecovery } from "../doctor-auto-recovery.ts";

function makeReport(overrides: Partial<DoctorReport>): DoctorReport {
  return {
    ok: true,
    basePath: "/repo",
    issues: [],
    fixesApplied: [],
    ...overrides,
  };
}

test("doctor trouble recovery proceeds when deterministic doctor fixes clear blocking issues", async () => {
  const result = await resolveDoctorTroubleRecovery({
    basePath: "/repo",
    triggerIssues: ["STATE.md missing"],
    runDoctor: async () => makeReport({
      ok: true,
      fixesApplied: ["created STATE.md from derived state"],
    }),
    selectScope: async () => "M001/S01",
  });

  assert.equal(result.action, "proceed");
  assert.deepEqual(result.fixesApplied, ["created STATE.md from derived state"]);
  assert.equal(result.scope, "M001/S01");
});

test("doctor trouble recovery returns a doctor-heal sidecar for actionable unresolved issues", async () => {
  const result = await resolveDoctorTroubleRecovery({
    basePath: "/repo",
    triggerIssues: ["Plan gate failed"],
    runDoctor: async () => makeReport({
      ok: false,
      issues: [{
        severity: "error",
        code: "missing_slice_dir",
        scope: "slice",
        unitId: "M001/S01",
        message: "Missing slice directory for M001/S01",
        file: ".gsd/milestones/M001/slices/S01",
        fixable: true,
      }],
    }),
    selectScope: async () => "M001/S01",
  });

  assert.equal(result.action, "doctor-heal");
  assert.equal(result.issueCount, 1);
  assert.equal(result.sidecar.unitType, "doctor-heal");
  assert.equal(result.sidecar.unitId, "M001/S01");
  assert.match(result.sidecar.prompt, /GSD doctor heal mode/);
  assert.match(result.sidecar.prompt, /Plan gate failed/);
  assert.match(result.sidecar.prompt, /missing_slice_dir/);
});

test("doctor trouble recovery pauses when unresolved doctor issues are not actionable", async () => {
  const result = await resolveDoctorTroubleRecovery({
    basePath: "/repo",
    triggerIssues: ["Git remote unreachable"],
    runDoctor: async () => makeReport({
      ok: false,
      issues: [{
        severity: "error",
        code: "env_git_remote",
        scope: "project",
        unitId: "environment",
        message: "Git remote 'origin' is unreachable",
        fixable: false,
      }],
    }),
    selectScope: async () => undefined,
  });

  assert.equal(result.action, "pause");
  assert.match(result.reason, /Git remote 'origin' is unreachable/);
});
