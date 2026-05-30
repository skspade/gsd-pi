// gsd-pi — planning path scope regression tests.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validatePlanningPathScope } from "../planning-path-scope.ts";

test("validatePlanningPathScope accepts symlink spellings of an allowed root", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-planning-path-scope-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const realRoot = join(base, "real-worktree");
  const symlinkRoot = join(base, "local-worktree");
  mkdirSync(join(realRoot, "src"), { recursive: true });
  writeFileSync(join(realRoot, "src", "existing.ts"), "export {};\n", "utf-8");
  symlinkSync(realRoot, symlinkRoot, "junction");

  const result = validatePlanningPathScope(
    symlinkRoot,
    [{
      field: "files",
      values: ["src/existing.ts", "src/new-file.ts"],
    }],
    [realRoot],
  );

  assert.equal(result, null);
});
