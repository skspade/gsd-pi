// Project/App: gsd-pi
// File Purpose: Regression tests for npm package script metadata.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  findMissingPublishedScriptFiles,
  pruneRootPackageScripts,
} = require("../lib/package-scripts.cjs");

test("prepack publishes only runtime npm scripts", () => {
  const pkg = {
    scripts: {
      "build:core": "tsc && pnpm run copy-resources",
      gsd: "node scripts/dev-cli.js",
      postinstall: "node scripts/install.js",
      prepack: "node scripts/prepack-resolve-workspace.cjs",
      "test:compile": "node scripts/compile-tests.mjs",
    },
  };

  const changed = pruneRootPackageScripts(pkg);

  assert.equal(changed, true);
  assert.deepEqual(pkg.scripts, {
    postinstall: "node scripts/install.js",
  });
});

test("published script validation reports missing local file references", () => {
  const pkg = {
    scripts: {
      check: "node scripts/missing.mjs --import ./scripts/loader.mjs",
      postinstall: "node scripts/install.js",
    },
  };
  const packedFiles = new Set(["package.json", "scripts/install.js"]);

  assert.deepEqual(findMissingPublishedScriptFiles(pkg, packedFiles), [
    { script: "check", path: "scripts/missing.mjs" },
    { script: "check", path: "scripts/loader.mjs" },
  ]);
});
