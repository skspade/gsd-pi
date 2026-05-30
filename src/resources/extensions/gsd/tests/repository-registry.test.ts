// gsd-pi + Repository registry seam tests.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryRegistryFromPreferences, defaultRepositoryTargets } from "../repository-registry.ts";

test("repository registry includes implicit project root and declared child repos", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });
  mkdirSync(join(base, "backend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend", role: "web UI", verification: ["npm test"] },
        backend: { path: "./backend", role: "API", commit_policy: "skip" },
      },
    },
  });

  assert.equal(registry.mode, "parent");
  assert.equal(registry.projectRoot, base);
  assert.equal(registry.byId.size, 3);
  assert.equal(registry.byId.get("project")?.root, base);
  assert.equal(registry.byId.get("frontend")?.root, join(base, "frontend"));
  assert.equal(registry.byId.get("backend")?.root, join(base, "backend"));
  assert.deepEqual(registry.byId.get("frontend")?.verification, ["npm test"]);
  assert.equal(registry.byId.get("frontend")?.role, "web UI");
  assert.equal(registry.byId.get("backend")?.commitPolicy, "skip");
  assert.equal(registry.byId.get("backend")?.role, "API");
});

test("repository registry rejects repositories outside project root", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          unsafe: { path: "../outside" },
        },
      },
    }),
    /outside project root/,
  );
});

test('repository registry rejects explicit "project" repository id', (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  assert.throws(
    () => createRepositoryRegistryFromPreferences(base, {
      workspace: {
        mode: "parent",
        repositories: {
          project: { path: "." },
        },
      },
    }),
    /reserved/,
  );
});

test("defaultRepositoryTargets returns [project] for a single-repo project registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, undefined);

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});

test("defaultRepositoryTargets returns [project] for a parent-mode registry", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  mkdirSync(join(base, "frontend"), { recursive: true });

  const registry = createRepositoryRegistryFromPreferences(base, {
    workspace: {
      mode: "parent",
      repositories: {
        frontend: { path: "frontend" },
      },
    },
  });

  assert.deepEqual(defaultRepositoryTargets(registry), ["project"]);
});

test("repository registry preserves active symlinked worktree root as an execution root", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-repo-registry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const projectRoot = join(base, "project");
  const externalGsd = join(base, "external-gsd");
  const physicalWorktree = join(externalGsd, "worktrees", "M001");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(physicalWorktree, { recursive: true });
  symlinkSync(externalGsd, join(projectRoot, ".gsd"), "junction");

  try {
    execFileSync("git", ["init"], { cwd: physicalWorktree, stdio: "ignore" });
  } catch {
    t.skip("git is required for this registry regression");
    return;
  }

  const localWorktree = join(projectRoot, ".gsd", "worktrees", "M001");
  const registry = createRepositoryRegistryFromPreferences(localWorktree, undefined);
  const projectRepo = registry.byId.get("project");

  assert.ok(projectRepo);
  assert.equal(projectRepo.root, realpathSync(physicalWorktree));
  assert.ok(projectRepo.executionRoots.includes(projectRepo.root));
  assert.ok(projectRepo.executionRoots.includes(localWorktree));
  assert.ok(registry.executionRoots.includes(localWorktree));
});
