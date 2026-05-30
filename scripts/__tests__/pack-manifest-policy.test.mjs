// Project/App: gsd-pi
// File Purpose: Contract tests for packed root package manifest script policy.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { shapePackedRootManifest } = require('../lib/pack-manifest-policy.cjs');

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

function shapePackageWithScripts(extraScripts = {}) {
  return shapePackedRootManifest({
    ...rootPackage,
    scripts: {
      ...rootPackage.scripts,
      ...extraScripts,
    },
  });
}

function assertScriptsRemoved(result, scriptNames) {
  const removedNames = new Set(result.removedScripts.map((script) => script.name));

  for (const name of scriptNames) {
    assert.ok(removedNames.has(name), `${name} should be removed from the packed manifest`);
    assert.equal(
      Object.hasOwn(result.manifest.scripts ?? {}, name),
      false,
      `${name} should not remain in shaped manifest scripts`,
    );
  }
}

function assertOnlyScriptsRetained(result, scriptNames) {
  const actualNames = Object.keys(result.manifest.scripts ?? {}).sort();
  const expectedNames = [...scriptNames].sort();

  assert.deepEqual(
    actualNames,
    expectedNames,
    `expected only ${expectedNames.join(', ')} to be retained, got ${actualNames.join(', ')}`,
  );

  const retainedNames = new Set(result.retainedScripts.map((script) => script.name));
  for (const name of scriptNames) {
    assert.ok(retainedNames.has(name), `${name} should be visible in retained script diagnostics`);
  }
}

test('shapePackedRootManifest removes issue #2 package script examples', () => {
  const result = shapePackageWithScripts();

  assertScriptsRemoved(result, [
    'test:compile',
    'test:unit:compiled',
    'validate-pack',
  ]);
});

test('shapePackedRootManifest removes lifecycle and publish internals', () => {
  const result = shapePackageWithScripts();

  assertScriptsRemoved(result, [
    'prepack',
    'postpack',
    'prepublishOnly',
  ]);
});

test('shapePackedRootManifest removes representative dev, build, audit, release, and source-runner scripts', () => {
  const result = shapePackageWithScripts();

  assertScriptsRemoved(result, [
    'build',
    'build:native',
    'copy-resources',
    'dev',
    'gsd',
    'gsd:web',
    'verify:fast',
    'audit:test-gaps',
    'release:changelog',
    'pipeline:version-stamp',
    'docker:build-runtime',
    'test:e2e',
    'test:live-regression',
    'baseline:refactor',
    'prototype:tui-design',
    'legacy:cleanup:gate',
    'legacy:cleanup:evidence',
    'pi:install-global',
    'pi:uninstall-global',
  ]);
});

test('shapePackedRootManifest retains only postinstall from the current root package scripts', () => {
  const result = shapePackageWithScripts();

  assertOnlyScriptsRetained(result, ['postinstall']);
});

test('shapePackedRootManifest preserves installed-package runtime behavior and future runtime-looking scripts', () => {
  const result = shapePackageWithScripts({
    'runtime:healthcheck': 'node dist/healthcheck.js',
  });

  assert.equal(result.manifest.scripts.postinstall, 'node scripts/install.js');
  assert.deepEqual(result.manifest.bin, rootPackage.bin);
  assert.equal(result.manifest.scripts['runtime:healthcheck'], 'node dist/healthcheck.js');
  assertOnlyScriptsRetained(result, ['postinstall', 'runtime:healthcheck']);
});

test('shapePackedRootManifest does not mutate the source package object', () => {
  const original = {
    name: 'example-package',
    bin: {
      example: 'dist/index.js',
    },
    scripts: {
      postinstall: 'node scripts/install.js',
      'test:compile': 'node scripts/compile-tests.mjs',
      'runtime:healthcheck': 'node dist/healthcheck.js',
    },
  };
  const originalSnapshot = structuredClone(original);

  const result = shapePackedRootManifest(original);

  assert.deepEqual(original, originalSnapshot);
  assert.notEqual(result.manifest, original);
  assert.notEqual(result.manifest.scripts, original.scripts);
  assert.equal(original.scripts['test:compile'], 'node scripts/compile-tests.mjs');
  assert.equal(result.manifest.scripts['test:compile'], undefined);
});

test('shapePackedRootManifest safely handles package objects without scripts', () => {
  const pkgWithoutScripts = {
    name: 'example-package',
    version: '0.0.0',
    bin: {
      example: 'dist/index.js',
    },
  };

  const result = shapePackedRootManifest(pkgWithoutScripts);

  assert.deepEqual(result.manifest, pkgWithoutScripts);
  assert.equal(Object.hasOwn(result.manifest, 'scripts'), false);
  assert.deepEqual(result.removedScripts, []);
  assert.deepEqual(result.retainedScripts, []);
});
