import test from "node:test";
import assert from "node:assert/strict";

import { runPreDispatch } from "../auto/phases.ts";

function makeLoopState() {
  return {
    recentUnits: [],
    stuckRecoveryAttempts: 0,
    consecutiveFinalizeTimeouts: 0,
  };
}

function makeBlockedState() {
  return {
    phase: "blocked",
    activeMilestone: { id: "M005", title: "Milestone five" },
    activeSlice: null,
    activeTask: null,
    recentDecisions: [],
    blockers: ["Milestone M005 validation verdict is needs-remediation but all slices are complete."],
    nextAction: "Resolve M005 remediation before proceeding.",
    registry: [{ id: "M005", status: "active" }],
  };
}

test("runPreDispatch resumes loop when auto resolver clears blocked state", async () => {
  let pauseCalls = 0;
  let resolverCalls = 0;
  const ic = {
    ctx: { ui: { notify() {} } },
    pi: {},
    s: {
      basePath: "/tmp/gsd-test",
      originalBasePath: "/tmp/gsd-test",
      canonicalProjectRoot: "/tmp/gsd-test",
      resourceVersionOnStart: "test",
      currentMilestoneId: null,
      currentUnit: null,
      milestoneMergedInPhases: false,
    },
    prefs: { auto_resolve: { enabled: true } },
    iteration: 1,
    flowId: "flow-1",
    nextSeq: () => 1,
    deps: {
      checkResourcesStale() { return null; },
      invalidateAllCaches() {},
      async preDispatchHealthGate() { return { proceed: true, fixesApplied: [] }; },
      async deriveState() { return makeBlockedState(); },
      syncCmuxSidebar() {},
      setActiveMilestoneId() {},
      getIsolationMode() { return "none"; },
      captureIntegrationBranch() {},
      pruneQueueOrder() {},
      async rebuildState() {},
      reconcileMergeState() { return "clean"; },
      async pauseAuto() { pauseCalls++; },
      sendDesktopNotification() {},
      logCmuxEvent() {},
      emitJournalEvent() {},
      async maybeAutoResolveGate(input: unknown) {
        resolverCalls++;
        assert.match(JSON.stringify(input), /needs-remediation/);
        return { action: "resume", status: "resolved", summary: "fixed" };
      },
    },
  } as any;

  const result = await runPreDispatch(ic, makeLoopState());

  assert.deepEqual(result, { action: "continue" });
  assert.equal(resolverCalls, 1);
  assert.equal(pauseCalls, 0);
});

test("runPreDispatch keeps existing pause behavior when auto resolver skips blocked state", async () => {
  let pauseCalls = 0;
  const notifications: Array<{ message: string; level?: string }> = [];
  const ic = {
    ctx: { ui: { notify(message: string, level?: string) { notifications.push({ message, level }); } } },
    pi: {},
    s: {
      basePath: "/tmp/gsd-test",
      originalBasePath: "/tmp/gsd-test",
      canonicalProjectRoot: "/tmp/gsd-test",
      resourceVersionOnStart: "test",
      currentMilestoneId: null,
      currentUnit: null,
      milestoneMergedInPhases: false,
    },
    prefs: { auto_resolve: { enabled: false } },
    iteration: 1,
    flowId: "flow-1",
    nextSeq: () => 1,
    deps: {
      checkResourcesStale() { return null; },
      invalidateAllCaches() {},
      async preDispatchHealthGate() { return { proceed: true, fixesApplied: [] }; },
      async deriveState() { return makeBlockedState(); },
      syncCmuxSidebar() {},
      setActiveMilestoneId() {},
      getIsolationMode() { return "none"; },
      captureIntegrationBranch() {},
      pruneQueueOrder() {},
      async rebuildState() {},
      reconcileMergeState() { return "clean"; },
      async pauseAuto() { pauseCalls++; },
      sendDesktopNotification() {},
      logCmuxEvent() {},
      emitJournalEvent() {},
      async maybeAutoResolveGate() {
        return { action: "skip", status: "skipped", summary: "disabled" };
      },
    },
  } as any;

  const result = await runPreDispatch(ic, makeLoopState());

  assert.deepEqual(result, { action: "break", reason: "blocked" });
  assert.equal(pauseCalls, 1);
  assert.ok(notifications.some(n => n.level === "warning" && /Blocked:/.test(n.message)));
});
