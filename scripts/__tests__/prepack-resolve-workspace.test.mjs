// Project/App: gsd-pi
// File Purpose: Integration tests for prepack manifest mutation and postpack restore behavior.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { shapePackedRootManifest } = require('../lib/pack-manifest-policy.cjs');

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PREPACK_SCRIPT = path.join(ROOT, 'scripts/prepack-resolve-workspace.cjs');
const POSTPACK_SCRIPT = path.join(ROOT, 'scripts/postpack-restore-workspace.cjs');
const ROOT_PACKAGE_JSON = path.join(ROOT, 'package.json');
const WORKSPACE_PACKAGE_JSON = path.join(ROOT, 'packages/cloud-mcp-gateway/package.json');
const BACKUP_DIR = path.join(ROOT, '.prepack-backup');
const ROOT_BACKUP_PACKAGE_JSON = path.join(BACKUP_DIR, 'package.json');
const WORKSPACE_BACKUP_PACKAGE_JSON = path.join(
  BACKUP_DIR,
  'packages/cloud-mcp-gateway/package.json',
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runScript(scriptPath) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function assertScriptsAbsent(manifest, scriptNames) {
  for (const name of scriptNames) {
    assert.equal(
      Object.hasOwn(manifest.scripts ?? {}, name),
      false,
      `${name} should be removed from package.json during prepack`,
    );
  }
}

function assertScriptsPresent(manifest, scriptNames) {
  for (const name of scriptNames) {
    assert.equal(
      Object.hasOwn(manifest.scripts ?? {}, name),
      true,
      `${name} should be retained in package.json during prepack`,
    );
  }
}

test('prepack shapes the root manifest, preserves backups, and postpack restores sources', () => {
  if (existsSync(BACKUP_DIR)) {
    runScript(POSTPACK_SCRIPT);
  }

  const originalRootRaw = readFileSync(ROOT_PACKAGE_JSON, 'utf8');
  const originalWorkspaceRaw = readFileSync(WORKSPACE_PACKAGE_JSON, 'utf8');
  const originalRoot = JSON.parse(originalRootRaw);
  const originalWorkspace = JSON.parse(originalWorkspaceRaw);
  const expectedShapedRoot = shapePackedRootManifest(originalRoot).manifest;
  const assertionErrors = [];

  try {
    const prepackOutput = runScript(PREPACK_SCRIPT);
    const shapedRoot = readJson(ROOT_PACKAGE_JSON);
    const shapedWorkspace = readJson(WORKSPACE_PACKAGE_JSON);
    const backedUpRootRaw = readFileSync(ROOT_BACKUP_PACKAGE_JSON, 'utf8');
    const backedUpWorkspace = readJson(WORKSPACE_BACKUP_PACKAGE_JSON);

    assert.match(
      prepackOutput,
      /\[prepack\] Removed internal workspace deps from package\.json/,
      'prepack output should report root internal dependency cleanup',
    );
    assert.match(
      prepackOutput,
      /\[prepack\] Shaped root scripts in package\.json \(removed \d+\)/,
      'prepack output should report root script shaping',
    );
    assert.match(
      prepackOutput,
      /\[prepack\] Resolved workspace:\* internal deps in packages\/cloud-mcp-gateway\/package\.json/,
      'prepack output should report workspace dependency range cleanup',
    );

    assertScriptsAbsent(shapedRoot, [
      'build',
      'dev',
      'legacy:cleanup:gate',
      'pi:install-global',
      'postpack',
      'prepack',
      'prepublishOnly',
      'test',
      'validate-pack',
    ]);
    assertScriptsPresent(shapedRoot, ['postinstall']);
    assert.deepEqual(
      shapedRoot.scripts,
      expectedShapedRoot.scripts,
      'prepack should shape only the root script surface defined by pack-manifest-policy',
    );
    assert.equal(
      Object.hasOwn(shapedRoot.dependencies ?? {}, '@gsd/pi-tui'),
      false,
      'root internal workspace dependencies should be removed during prepack',
    );
    assert.equal(
      shapedRoot.dependencies?.['@anthropic-ai/sdk'],
      originalRoot.dependencies['@anthropic-ai/sdk'],
      'root external runtime dependencies should remain during prepack',
    );

    assert.equal(
      backedUpRootRaw,
      originalRootRaw,
      '.prepack-backup/package.json should contain the exact original unshaped root manifest',
    );
    assertScriptsPresent(readJson(ROOT_BACKUP_PACKAGE_JSON), [
      'build',
      'legacy:cleanup:gate',
      'postinstall',
      'postpack',
      'prepack',
      'test',
    ]);
    assert.equal(
      backedUpWorkspace.dependencies['@opengsd/mcp-server'],
      originalWorkspace.dependencies['@opengsd/mcp-server'],
      'workspace backup should preserve the original workspace:* dependency range',
    );

    assert.equal(
      shapedWorkspace.dependencies['@opengsd/mcp-server'],
      `^${originalWorkspace.version}`,
      'workspace package internal dependency should still resolve to its package version',
    );
  } catch (error) {
    assertionErrors.push(error);
  } finally {
    try {
      const postpackOutput = runScript(POSTPACK_SCRIPT);
      assert.match(
        postpackOutput,
        /\[postpack\] Restored package\.json/,
        'postpack output should report root package restoration',
      );
      assert.equal(
        readFileSync(ROOT_PACKAGE_JSON, 'utf8'),
        originalRootRaw,
        'postpack should restore the root package.json exactly after prepack assertions',
      );
      assert.equal(
        readFileSync(WORKSPACE_PACKAGE_JSON, 'utf8'),
        originalWorkspaceRaw,
        'postpack should restore workspace package.json exactly after prepack assertions',
      );
      assert.equal(
        existsSync(BACKUP_DIR),
        false,
        'postpack should remove .prepack-backup after restoring manifests',
      );
    } catch (error) {
      assertionErrors.push(error);
    }
  }

  if (assertionErrors.length === 1) {
    throw assertionErrors[0];
  }
  if (assertionErrors.length > 1) {
    throw new AggregateError(assertionErrors, 'prepack integration assertions and cleanup failed');
  }
});
