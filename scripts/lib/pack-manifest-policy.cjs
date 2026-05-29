'use strict';

const EXACT_SCRIPT_NAMES_TO_REMOVE = new Set([
  'audit:test-confidence',
  'audit:test-gaps',
  'audit:test-matrix',
  'dev',
  'gsd',
  'postpack',
  'prepare',
  'prepack',
  'prepublish',
  'prepublishOnly',
  'secret-scan',
  'secret-scan:install-hook',
  'test',
  'validate-pack',
]);

const EXACT_INSTALLER_DEVELOPMENT_HELPERS = new Set([
  'pi:install-global',
  'pi:uninstall-global',
]);

const PREFIX_SCRIPT_CLASSES_TO_REMOVE = [
  { prefix: 'audit:', reason: 'audit/internal' },
  { prefix: 'baseline:', reason: 'baseline/internal' },
  { prefix: 'build:', reason: 'build/internal' },
  { prefix: 'copy-', reason: 'copy/internal' },
  { prefix: 'coverage:', reason: 'coverage/internal' },
  { prefix: 'docker:', reason: 'docker/internal' },
  { prefix: 'gsd:', reason: 'source-runner/internal' },
  { prefix: 'pipeline:', reason: 'pipeline/internal' },
  { prefix: 'prototype:', reason: 'prototype/internal' },
  { prefix: 'release:', reason: 'release/internal' },
  { prefix: 'stage:', reason: 'stage/internal' },
  { prefix: 'sync-', reason: 'sync/internal' },
  { prefix: 'test:', reason: 'test/internal' },
  { prefix: 'typecheck:', reason: 'typecheck/internal' },
  { prefix: 'verify:', reason: 'verify/internal' },
];

const LIFECYCLE_AND_PUBLISH_NAMES = new Set([
  'postpublish',
  'postversion',
  'prepublish',
  'prepublishOnly',
  'preversion',
  'publish',
  'version',
]);

const COMMAND_INTENT_PATTERNS_TO_REMOVE = [
  {
    pattern: /(?:^|\s)(?:pnpm|npm|npx|yarn)\s+(?:run\s+)?(?:build|test|verify|audit|release|pipeline|typecheck|validate-pack)\b/,
    reason: 'package-manager-dev-command',
  },
  {
    pattern: /(?:^|\s)(?:tsc|vitest|c8|cross-env|docker)\b/,
    reason: 'dev-tool-command',
  },
  {
    pattern: /(?:^|\s)node\s+(?:--\S+\s+)*scripts\/(?:build|compile-tests|copy|stage|validate-pack|verify|audit|run-test-evaluation|prepublish|version-stamp|generate-changelog|bump-version|update-changelog|sync-|dev|dev-cli|bootstrap-pi-coding-agent-build)/,
    reason: 'source-repo-script-command',
  },
  {
    pattern: /(?:^|\s)bash\s+scripts\/(?:ci-|verify-|release|pipeline)/,
    reason: 'source-repo-shell-command',
  },
];

function normalizeScriptName(name) {
  return String(name || '').trim();
}

function normalizeCommand(command) {
  return typeof command === 'string' ? command.trim() : '';
}

function classifyPackedRootScript(name, command) {
  const normalizedName = normalizeScriptName(name);
  const normalizedCommand = normalizeCommand(command);

  if (!normalizedName) {
    return {
      remove: false,
      reason: 'missing-name',
      matchedBy: 'none',
    };
  }

  if (EXACT_INSTALLER_DEVELOPMENT_HELPERS.has(normalizedName)) {
    return {
      remove: true,
      reason: 'installer-development-helper',
      matchedBy: 'exact-name',
    };
  }

  if (EXACT_SCRIPT_NAMES_TO_REMOVE.has(normalizedName)) {
    return {
      remove: true,
      reason: 'known-dev-or-packaging-script',
      matchedBy: 'exact-name',
    };
  }

  if (LIFECYCLE_AND_PUBLISH_NAMES.has(normalizedName)) {
    return {
      remove: true,
      reason: 'lifecycle-or-publish-internal',
      matchedBy: 'lifecycle-name',
    };
  }

  for (const { prefix, reason } of PREFIX_SCRIPT_CLASSES_TO_REMOVE) {
    if (normalizedName.startsWith(prefix)) {
      return {
        remove: true,
        reason,
        matchedBy: 'name-prefix',
      };
    }
  }

  for (const { pattern, reason } of COMMAND_INTENT_PATTERNS_TO_REMOVE) {
    if (pattern.test(normalizedCommand)) {
      return {
        remove: true,
        reason,
        matchedBy: 'command-intent',
      };
    }
  }

  return {
    remove: false,
    reason: 'retained-for-runtime-reference-validation',
    matchedBy: 'none',
  };
}

function shouldRemovePackedRootScript(name, command) {
  return classifyPackedRootScript(name, command).remove;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shapePackedRootManifest(pkg) {
  if (!isPlainObject(pkg)) {
    throw new TypeError('shapePackedRootManifest expected a package manifest object');
  }

  const manifest = { ...pkg };
  const sourceScripts = isPlainObject(pkg.scripts) ? pkg.scripts : undefined;
  const scripts = {};
  const removedScripts = [];
  const retainedScripts = [];

  if (!sourceScripts) {
    return {
      manifest,
      removedScripts,
      retainedScripts,
    };
  }

  for (const [name, command] of Object.entries(sourceScripts)) {
    const classification = classifyPackedRootScript(name, command);
    if (classification.remove) {
      removedScripts.push({
        name,
        command,
        reason: classification.reason,
        matchedBy: classification.matchedBy,
      });
      continue;
    }

    scripts[name] = command;
    retainedScripts.push({
      name,
      command,
      reason: classification.reason,
    });
  }

  if (Object.keys(scripts).length > 0) {
    manifest.scripts = scripts;
  } else {
    delete manifest.scripts;
  }

  return {
    manifest,
    removedScripts,
    retainedScripts,
  };
}

module.exports = {
  classifyPackedRootScript,
  shouldRemovePackedRootScript,
  shapePackedRootManifest,
};
