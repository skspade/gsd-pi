import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeFindingFingerprint,
  extractFindingsJson,
  parseRetrospectiveMarkdown,
  readIssueMap,
  resolveRetrospectivePaths,
  writeIssueMap,
} from "../retrospective-artifacts.ts";
import type {
  RetrospectiveFinding,
  RetrospectiveIssueMap,
} from "../retrospective-types.ts";

function makeTempBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-retro-artifacts-"));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function makeFinding(overrides: Partial<RetrospectiveFinding> = {}): RetrospectiveFinding {
  return {
    title: "Tests hid a route mismatch",
    summary: "A similarly named view made debugging slower.",
    category: "bug",
    severity: "medium",
    confidence: "high",
    evidence: ["Route /lineage-explorer was owned by LineageGraphVisualizerView."],
    suggestedFix: "Grep route ownership before editing view files.",
    fingerprint: "0".repeat(64),
    ...overrides,
  };
}

test("resolveRetrospectivePaths returns milestone retrospective artifact paths", () => {
  const base = makeTempBase();
  try {
    const paths = resolveRetrospectivePaths(base, "M001");

    assert.equal(paths.retro, join(base, ".gsd", "milestones", "M001", "M001-RETRO.md"));
    assert.equal(paths.issueMap, join(base, ".gsd", "milestones", "M001", "M001-RETRO-ISSUES.json"));
  } finally {
    cleanup(base);
  }
});

test("extractFindingsJson returns the first fenced json block", () => {
  const markdown = [
    "# Retrospective",
    "```json",
    JSON.stringify({ note: "first block" }),
    "```",
    "```json",
    JSON.stringify({ findings: [makeFinding()] }),
    "```",
  ].join("\n");

  const rawJson = extractFindingsJson(markdown);
  assert.notEqual(rawJson, null);
  assert.deepEqual(JSON.parse(rawJson!), { note: "first block" });

  const parsed = parseRetrospectiveMarkdown(markdown);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 0);
});

test("parseRetrospectiveMarkdown validates findings and computes missing fingerprints", () => {
  const markdown = [
    "# Retrospective",
    "```json",
    JSON.stringify({
      findings: [
        {
          title: "  Tests hid a route mismatch  ",
          summary: "A similarly named view made debugging slower.",
          category: "bug",
          severity: "medium",
          confidence: "high",
          evidence: ["Route ownership was not checked."],
          suggestedFix: "Grep route ownership before editing view files.",
        },
      ],
    }),
    "```",
  ].join("\n");

  const parsed = parseRetrospectiveMarkdown(markdown);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]?.title, "Tests hid a route mismatch");
  assert.match(parsed.findings[0]?.fingerprint ?? "", /^[a-f0-9]{64}$/);
});

test("parseRetrospectiveMarkdown skips invalid findings", () => {
  const markdown = [
    "```json",
    JSON.stringify({
      findings: [
        {
          title: "Missing category",
          summary: "Invalid finding",
          severity: "medium",
          confidence: "high",
          evidence: ["evidence"],
          suggestedFix: "fix",
        },
      ],
    }),
    "```",
  ].join("\n");

  const parsed = parseRetrospectiveMarkdown(markdown);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 0);
});

test("parseRetrospectiveMarkdown reports malformed json without throwing", () => {
  const parsed = parseRetrospectiveMarkdown(["```json", "{", "```"].join("\n"));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error ?? "", /json|expected|unexpected/i);
});

test("computeFindingFingerprint is stable for equivalent case and whitespace", () => {
  const first = computeFindingFingerprint(makeFinding({
    title: " Route ownership mismatch ",
    category: "bug",
    evidence: ["Lineage route used LineageGraphVisualizerView."],
  }));
  const second = computeFindingFingerprint(makeFinding({
    title: "route   ownership\nmismatch",
    category: "BUG" as RetrospectiveFinding["category"],
    evidence: [" lineage route used   lineagegraphvisualizerview. "],
  }));

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("writeIssueMap and readIssueMap round-trip RetrospectiveIssueMap JSON", () => {
  const base = makeTempBase();
  try {
    const paths = resolveRetrospectivePaths(base, "M001");
    const map: RetrospectiveIssueMap = {
      version: 1,
      milestoneId: "M001",
      issueRepo: "owner/repo",
      issueLabel: "retrospective",
      records: [
        {
          fingerprint: "a".repeat(64),
          title: "Tests hid a route mismatch",
          category: "bug",
          status: "created",
          issueNumber: 42,
          issueUrl: "https://github.com/owner/repo/issues/42",
          updatedAt: "2026-05-31T00:00:00.000Z",
        },
      ],
    };

    writeIssueMap(paths.issueMap, map);

    assert.deepEqual(readIssueMap(paths.issueMap), map);
  } finally {
    cleanup(base);
  }
});
