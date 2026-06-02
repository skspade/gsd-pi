#!/usr/bin/env node
'use strict';

const RUNTIME_SCRIPT_NAMES = ['postinstall'];

function scriptsEqual(left, right) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  for (const [name, command] of leftEntries) {
    if (right[name] !== command) return false;
  }
  return true;
}

function pruneRootPackageScripts(pkg) {
  const current = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const next = {};
  for (const name of RUNTIME_SCRIPT_NAMES) {
    if (typeof current[name] === 'string') next[name] = current[name];
  }

  if (scriptsEqual(current, next)) return false;
  if (Object.keys(next).length > 0) {
    pkg.scripts = next;
  } else {
    delete pkg.scripts;
  }
  return true;
}

function extractLocalScriptFileReferences(command) {
  if (typeof command !== 'string') return [];
  const references = [];
  const seen = new Set();
  const localPathPattern = /(?:^|[\s=])(?:["'])?(?:\.\/)?((?:scripts|native\/scripts|packages\/[^/\s"']+\/scripts)\/[^\s"']+)/g;
  for (const match of command.matchAll(localPathPattern)) {
    const path = match[1].replace(/[),;]+$/, '');
    if (seen.has(path)) continue;
    seen.add(path);
    references.push(path);
  }
  return references;
}

function findMissingPublishedScriptFiles(pkg, packedFiles) {
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const missing = [];
  const seen = new Set();
  for (const [script, command] of Object.entries(scripts)) {
    for (const path of extractLocalScriptFileReferences(command)) {
      const key = `${script}\0${path}`;
      if (packedFiles.has(path) || seen.has(key)) continue;
      seen.add(key);
      missing.push({ script, path });
    }
  }
  return missing;
}

module.exports = {
  findMissingPublishedScriptFiles,
  pruneRootPackageScripts,
};
