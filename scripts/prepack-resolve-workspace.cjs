#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.prepack-backup');

const {
  INTERNAL_PACKAGE_NAMES,
  RELEASE_WORKSPACE_PACKAGE_DIRS,
} = require('./lib/version-sync.cjs');
const { shapePackedRootManifest } = require('./lib/pack-manifest-policy.cjs');

const ROOT_PACKAGE_JSON = path.join(ROOT, 'package.json');
const TARGET_PACKAGE_JSONS = [
  ROOT_PACKAGE_JSON,
  ...RELEASE_WORKSPACE_PACKAGE_DIRS.map((dir) => path.join(ROOT, dir, 'package.json')),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function backupManifest(filePath, relPath) {
  const backupPath = path.join(BACKUP_DIR, relPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
}

function resolveInternalWorkspaceDeps(pkg, { isRoot, version }) {
  let changed = false;

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[field]) continue;
    for (const [dep, range] of Object.entries(pkg[field])) {
      if (!INTERNAL_PACKAGE_NAMES.has(dep)) continue;
      if (range !== 'workspace:*' && range !== '*') continue;
      if (isRoot) {
        // The published root no longer bundles workspace packages. Internal @gsd/@opengsd
        // packages are NOT on the public registry — they ship inside this tarball under
        // packages/*/dist and are symlinked into node_modules at postinstall by
        // link-workspace-packages.cjs. Leaving them in `dependencies` would make
        // `npm install` (and the installer's repair step) try to fetch them from the
        // registry and fail. Drop them; runtime resolution goes through the symlinks.
        delete pkg[field][dep];
        changed = true;
      } else {
        // Workspace package manifests ship as files (never npm-installed), so their
        // internal ranges are informational only. Pin to ^version for a clean tarball.
        const resolved = `^${version}`;
        if (pkg[field][dep] !== resolved) {
          pkg[field][dep] = resolved;
          changed = true;
        }
      }
    }
  }

  return changed;
}

function resolvePackageJson(filePath) {
  if (!fs.existsSync(filePath)) return false;

  let pkg = readJson(filePath);
  const version = pkg.version;
  const isRoot = filePath === ROOT_PACKAGE_JSON;
  const relPath = path.relative(ROOT, filePath);
  const dependencyChanged = resolveInternalWorkspaceDeps(pkg, { isRoot, version });
  let removedScripts = [];

  if (isRoot) {
    const shaped = shapePackedRootManifest(pkg);
    removedScripts = shaped.removedScripts;
    if (removedScripts.length > 0) {
      pkg = shaped.manifest;
    }
  }

  const scriptChanged = removedScripts.length > 0;
  if (!dependencyChanged && !scriptChanged) return false;

  backupManifest(filePath, relPath);
  writeJson(filePath, pkg);

  if (dependencyChanged) {
    console.log(
      isRoot
        ? `[prepack] Removed internal workspace deps from ${relPath} (shipped via files + postinstall link)`
        : `[prepack] Resolved workspace:* internal deps in ${relPath} to ^${version}`,
    );
  }

  if (scriptChanged) {
    console.log(`[prepack] Shaped root scripts in ${relPath} (removed ${removedScripts.length})`);
  }

  return true;
}

let resolvedAny = false;
for (const filePath of TARGET_PACKAGE_JSONS) {
  if (resolvePackageJson(filePath)) {
    resolvedAny = true;
  }
}

if (!resolvedAny && fs.existsSync(BACKUP_DIR)) {
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
}
