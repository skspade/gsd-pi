import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_RESOLVE_ATTEMPTS_KV_KEY,
  buildAutoResolveFingerprint,
  classifyAutoResolveGate,
  createMemoryAutoResolveAttemptStore,
  maybeAutoResolveGate,
  resolveAutoResolvePreferences,
  shouldAttemptAutoResolve,
} from "../auto-resolver.ts";

test("auto-resolve preferences default to enabled bounded state/config remediation", () => {
  assert.deepEqual(resolveAutoResolvePreferences(undefined), {
    enabled: true,
    max_attempts_per_gate: 1,
    write_scope: "state-and-config",
    include_provider: true,
    include_budget_context: true,
  });
});

test("classifyAutoResolveGate allows non-user machine gates", () => {
  const result = classifyAutoResolveGate({
    kind: "blocked",
    reason: "Milestone validation requires remediation",
    blockers: ["needs-remediation but all slices are complete"],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.gateKind, "blocked");
});

test("classifyAutoResolveGate rejects user approval and explicit stop gates", () => {
  for (const kind of ["approval-gate", "secrets", "user-stop", "user-backtrack"] as const) {
    const result = classifyAutoResolveGate({ kind, reason: "waiting for user" });
    assert.equal(result.eligible, false, kind);
    assert.match(result.reason, /user|approval|secrets|stop|backtrack/i);
  }
});

test("classifyAutoResolveGate respects provider and budget/context toggles", () => {
  assert.equal(
    classifyAutoResolveGate(
      { kind: "provider", reason: "rate limit" },
      { enabled: true, max_attempts_per_gate: 1, write_scope: "state-and-config", include_provider: false, include_budget_context: true },
    ).eligible,
    false,
  );
  assert.equal(
    classifyAutoResolveGate(
      { kind: "budget", reason: "budget ceiling reached" },
      { enabled: true, max_attempts_per_gate: 1, write_scope: "state-and-config", include_provider: true, include_budget_context: false },
    ).eligible,
    false,
  );
});

test("buildAutoResolveFingerprint normalizes reason text and scopes to unit identity", () => {
  const a = buildAutoResolveFingerprint({
    basePath: "/repo",
    gateKind: "blocked",
    reason: "Blocked:  needs remediation\n\nFix and run /gsd auto",
    unitType: "plan-slice",
    unitId: "M001/S01",
  });
  const b = buildAutoResolveFingerprint({
    basePath: "/repo",
    gateKind: "blocked",
    reason: " blocked: needs remediation Fix and run /gsd auto ",
    unitType: "plan-slice",
    unitId: "M001/S01",
  });
  const c = buildAutoResolveFingerprint({
    basePath: "/repo",
    gateKind: "blocked",
    reason: "Blocked: needs remediation Fix and run /gsd auto",
    unitType: "plan-slice",
    unitId: "M001/S02",
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("shouldAttemptAutoResolve allows one attempt per unchanged gate fingerprint", () => {
  const store = createMemoryAutoResolveAttemptStore();
  const fingerprint = "blocked:abc123";

  assert.equal(shouldAttemptAutoResolve(store, fingerprint, 1).attempt, true);
  store.record(fingerprint);
  assert.equal(shouldAttemptAutoResolve(store, fingerprint, 1).attempt, false);
  assert.equal(shouldAttemptAutoResolve(store, "blocked:def456", 1).attempt, true);
});

test("auto resolver attempt state uses stable runtime kv key", () => {
  assert.equal(AUTO_RESOLVE_ATTEMPTS_KV_KEY, "auto_resolve_attempts");
});

test("maybeAutoResolveGate resumes when deterministic repairs clear the gate", async () => {
  const store = createMemoryAutoResolveAttemptStore();
  let agentCalls = 0;

  const decision = await maybeAutoResolveGate({
    kind: "health-gate",
    reason: "doctor heal can repair state",
    basePath: "/repo",
    attemptStore: store,
    async runDeterministicRepairs() {
      return { fixesApplied: ["repaired .gsd state"], summary: "state repaired" };
    },
    async recheckGate() {
      return true;
    },
    async runResolverAgent() {
      agentCalls++;
      return { status: "resolved", summary: "agent should not run" };
    },
  });

  assert.equal(decision.action, "resume");
  assert.equal(decision.status, "resolved");
  assert.equal(agentCalls, 0);
});

test("maybeAutoResolveGate pauses when agent claims resolved but recheck still fails", async () => {
  const decision = await maybeAutoResolveGate({
    kind: "plan-v2",
    reason: "plan gate failed",
    basePath: "/repo",
    attemptStore: createMemoryAutoResolveAttemptStore(),
    async runDeterministicRepairs() {
      return { fixesApplied: [], summary: "no deterministic fix" };
    },
    async runResolverAgent() {
      return { status: "resolved", summary: "agent updated state", changedPaths: [".gsd/QUEUE.md"] };
    },
    async recheckGate() {
      return false;
    },
  });

  assert.equal(decision.action, "pause");
  assert.equal(decision.status, "unresolved");
  assert.match(decision.summary, /gate remained after recheck/);
});
