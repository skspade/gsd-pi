#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultPackDir = process.platform === "darwin" ? "/private/tmp" : tmpdir();

function usage() {
  process.stdout.write(`Usage: pnpm run deploy:local:mac [-- --skip-build] [--pack-destination <dir>]

Builds this checkout, packs it, installs that tarball globally with pnpm,
repairs bundled workspace links, syncs ~/.gsd/agent resources, and verifies
the installed gsd command points at the local build.

Options:
  --skip-build              Reuse existing dist/ artifacts.
  --pack-destination <dir>  Directory for the local .tgz. Default: ${defaultPackDir}
  -h, --help                Show this help.
`);
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function run(command, args, { cwd = repoRoot, env = process.env, capture = false } = {}) {
  process.stderr.write(`$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf-8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    const detail = capture ? `${result.stderr}\n${result.stdout}`.trim() : "";
    fail(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }

  return capture ? result.stdout.trim() : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function commandOutput(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function findOnPath(command, env = process.env) {
  const pathEnv = env.PATH ?? "";
  const names = process.platform === "win32" ? [`${command}.cmd`, `${command}.exe`, command] : [command];
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function resolveBinDir() {
  const configured = commandOutput("pnpm", ["config", "get", "global-bin-dir"]);
  if (configured && configured !== "undefined" && configured !== "null") return configured;

  const currentGsd = findOnPath("gsd");
  if (currentGsd) return dirname(currentGsd);

  const pnpmHome = process.env.PNPM_HOME;
  if (pnpmHome) return pnpmHome;

  return join(homedir(), ".local", "share", "pnpm");
}

function resolveGlobalDir() {
  const configured = commandOutput("pnpm", ["config", "get", "global-dir"]);
  if (configured && configured !== "undefined" && configured !== "null") return configured;

  const root = commandOutput("pnpm", ["root", "-g"]);
  if (root.endsWith("/node_modules")) {
    const versionedDir = dirname(root);
    return dirname(versionedDir);
  }

  return join(homedir(), "Library", "pnpm", "global");
}

function parseStoreDirFromModulesYaml(path) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf-8").match(/^storeDir:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function resolveStoreDir(globalDir) {
  const currentRoot = commandOutput("pnpm", ["root", "-g"]);
  if (currentRoot.endsWith("/node_modules")) {
    const currentStore = parseStoreDirFromModulesYaml(join(currentRoot, ".modules.yaml"));
    if (currentStore) return currentStore;
  }

  if (existsSync(globalDir)) {
    for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const storeDir = parseStoreDirFromModulesYaml(join(globalDir, entry.name, "node_modules", ".modules.yaml"));
      if (storeDir) return storeDir;
    }
  }

  const configured = commandOutput("pnpm", ["config", "get", "store-dir"], { cwd: homedir() });
  if (configured && configured !== "undefined" && configured !== "null") return configured;

  return commandOutput("pnpm", ["store", "path"], { cwd: homedir() });
}

function parseInstalledPackageRoot(gsdBin) {
  if (!existsSync(gsdBin)) return "";
  const body = readFileSync(gsdBin, "utf-8");
  const matches = body.matchAll(/"([^"]*node_modules\/@opengsd\/gsd-pi\/dist\/loader\.js)"/g);

  for (const match of matches) {
    const shimDir = dirname(gsdBin);
    const shimPath = match[1].replace(/^\$basedir(?=\/|$)/, shimDir);
    const loaderPath = resolve(shimDir, shimPath);
    if (existsSync(loaderPath)) return loaderPath.replace(/\/dist\/loader\.js$/, "");
  }

  return "";
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

async function syncResources(installedRoot) {
  const moduleUrl = pathToFileURL(join(installedRoot, "dist", "resource-loader.js")).href;
  const mod = await import(moduleUrl);
  mod.initResources(join(homedir(), ".gsd", "agent"));
}

function verifyHashMatch(installedRoot, relPath) {
  const local = join(repoRoot, relPath);
  const installed = join(installedRoot, relPath);
  if (!existsSync(local)) fail(`local verification file missing: ${relPath}`);
  if (!existsSync(installed)) fail(`installed verification file missing: ${relPath}`);
  const localHash = hashFile(local);
  const installedHash = hashFile(installed);
  if (localHash !== installedHash) {
    fail(`${relPath} hash mismatch: local ${localHash}, installed ${installedHash}`);
  }
  process.stderr.write(`verified ${relPath} ${installedHash}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let packDestination = defaultPackDir;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      usage();
      return;
    }
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (arg === "--pack-destination") {
      const value = args[++i];
      if (!value) fail("--pack-destination requires a directory");
      packDestination = resolve(value);
      continue;
    }
    fail(`unknown option: ${arg}`);
  }

  const pkg = readJson(join(repoRoot, "package.json"));
  const tarballName = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
  const tarballPath = join(packDestination, tarballName);

  if (!skipBuild) {
    run("pnpm", ["run", "build:core"]);
  }

  run("pnpm", ["pack", "--pack-destination", packDestination], { capture: true });
  if (!existsSync(tarballPath)) fail(`expected tarball was not created: ${tarballPath}`);

  const binDir = resolveBinDir();
  const globalDir = resolveGlobalDir();
  const storeDir = resolveStoreDir(globalDir);
  const installEnv = {
    ...process.env,
    PNPM_HOME: binDir,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
  const installArgs = ["--global-dir", globalDir];
  if (storeDir) installArgs.push("--store-dir", storeDir);
  installArgs.push("add", "-g", tarballPath);

  run("pnpm", installArgs, { env: installEnv });

  const gsdBin = join(binDir, process.platform === "win32" ? "gsd.cmd" : "gsd");
  const installedRoot = parseInstalledPackageRoot(gsdBin);
  if (!installedRoot || !existsSync(installedRoot)) {
    fail(`could not resolve installed package root from ${gsdBin}`);
  }

  run(process.execPath, ["scripts/link-workspace-packages.cjs"], { cwd: installedRoot });
  await syncResources(installedRoot);

  const version = run(gsdBin, ["--version"], { env: installEnv, capture: true });
  if (version !== pkg.version) {
    fail(`installed gsd version ${version || "(empty)"} does not match package ${pkg.version}`);
  }

  verifyHashMatch(installedRoot, "dist/loader.js");
  verifyHashMatch(installedRoot, "dist/resource-loader.js");
  verifyHashMatch(installedRoot, "dist/resources/extensions/gsd/workflow-mcp.js");

  const workflowCheck = run(process.execPath, [
    "--input-type=module",
    "-e",
    "const mod=await import('file://' + process.env.HOME + '/.gsd/agent/extensions/gsd/workflow-mcp.js'); const loaded=await mod.importWorkflowExecutorsModule(); console.log(typeof loaded.executeSummarySave, typeof loaded.executePlanSlice);",
  ], { capture: true });
  if (workflowCheck !== "function function") {
    fail(`workflow executor verification failed: ${workflowCheck}`);
  }

  process.stdout.write(`Installed local ${pkg.name}@${pkg.version}\n`);
  process.stdout.write(`gsd: ${gsdBin}\n`);
  process.stdout.write(`package: ${installedRoot}\n`);
  process.stdout.write(`tarball: ${tarballPath} (${statSync(tarballPath).mtime.toISOString()})\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
