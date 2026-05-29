# Packed npm script policy

## Decision

The packed root `package.json` should expose only installed-package runtime scripts. We choose runtime-only packed manifest cleanup over shipping every file referenced by the source repository's npm scripts.

This package already uses a runtime-focused `files` allowlist: built artifacts, package metadata, runtime resources, installer/linking scripts, and documentation ship in the tarball; the repo's test, build, release, and development script tree does not. Dependency consumers install the CLI and its runtime support files, not this repository's development toolchain. Publishing all source-repo scripts would either expand the tarball with non-runtime files or leave consumers with npm-run commands that reference omitted local files.

## Alternatives compared

### Runtime-only packed manifest cleanup

- Remove npm scripts whose purpose is development, validation, release, or package-publication internals before packing.
- Keep installed-package lifecycle/runtime scripts whose referenced files are included by `files`.
- Keep app launch as the `bin` contract (`gsd`, `gsd-cli`, `gsd-pi`) rather than exposing source-repo npm scripts such as `gsd` or `dev`.
- Reduces the public npm-run surface to commands that can reasonably work from an installed dependency.

Tradeoff: the prepack path must shape the root manifest and log what changed, and retained scripts still need a reference guard to ensure they point at files included in the tarball.

### Ship every referenced dev script/file

- Preserve the source `scripts` object exactly and add every referenced helper, test harness, baseline, release, docker, and development file to `files`.
- Avoids prepack script removal but turns source-repo internals into an installed-package contract.
- Increases package size and maintenance risk because every new repo script can accidentally become public API.
- Requires consumers to receive tooling they do not need and may not have the environment to run.

Tradeoff: this is simpler at pack time but conflicts with the runtime-focused package boundary.

## Removal classes

The packed root manifest should remove scripts in these classes:

- Lifecycle and publish internals: `prepack`, `postpack`, `prepare`, `prepublish`, `prepublishOnly`, publish/version hooks, and commands that run package-publish checks.
- Build, stage, copy, development, and source-runner scripts: `build:*`, `stage:*`, `copy-*`, `dev`, source-repo `gsd` wrappers, and commands that run local build or dev entrypoints.
- Test, coverage, evaluation, baseline, prototype, live, and end-to-end scripts: `test:*`, `test`, `coverage:*`, `baseline:*`, `prototype:*`, `test:live*`, and `test:e2e*`.
- Verification, audit, security, release, pipeline, sync, docker, and native internals: `verify:*`, `validate-pack`, `audit:*`, `secret-scan`, `release:*`, `pipeline:*`, `sync-*`, `docker:*`, `build:native*`, `test:native`, and native platform verification helpers.
- Installer-development helpers: `pi:install-global` and `pi:uninstall-global`.

The policy is classification-based rather than an allowlist. A script that looks like an installed runtime command and does not fall into a removal class should remain; S03's retained-script reference guard is responsible for failing retained scripts that reference files omitted from the tarball.

## Retained script intent

Retained scripts must be useful from an installed package and must reference files that ship in the tarball. The current required retained lifecycle script is:

```json
{
  "postinstall": "node scripts/install.js"
}
```

`postinstall` remains because `scripts/install.js` is included in `files` and performs installed-package setup. CLI app launch remains through the `bin` entries instead of npm scripts:

```json
{
  "bin": {
    "gsd": "dist/loader.js",
    "gsd-cli": "dist/loader.js",
    "gsd-pi": "scripts/install.js"
  }
}
```

## Implementation contract

`scripts/lib/pack-manifest-policy.cjs` is the importable policy surface for S02. It must:

- classify root scripts with `shouldRemovePackedRootScript(name, command)`;
- shape only the root manifest's `scripts` field with `shapePackedRootManifest(pkg)`;
- preserve all other manifest fields;
- avoid mutating the caller's source object;
- return removed and retained script names so prepack logging can explain the packed-manifest cleanup.

S01 intentionally does not wire the helper into `scripts/prepack-resolve-workspace.cjs`; S02 owns pack-time mutation and logging.
