# Milestone Retrospective Agent Design

## Summary

Add a first-class `retrospect-milestone` unit to GSD. The unit runs at the end of a milestone, analyzes what went wrong or caused friction during the run, and automatically files one GitHub issue per finding in the user's personal fork only.

The only target repo is `skspade/gsd-pi`. The feature must never file issues in `open-gsd/gsd-pi`.

## Goals

- Run after both successful milestone completion and failed, stuck, or aborted milestone-scoped runs.
- Detect broad GSD improvement signals, not only hard-coded bugs.
- File one GitHub issue per finding automatically.
- Label every created issue with a dedicated auto-retro label so the user can review them after the fact.
- Keep the retrospective best-effort and non-blocking.
- Persist local audit artifacts so repeated runs are idempotent and reviewable.

## Non-Goals

- Do not fix findings during the retrospective unit.
- Do not create issues in the upstream/base repository.
- Do not require per-issue confirmation.
- Do not make milestone completion depend on retrospective success.
- Do not file issues for ordinary user-project implementation work unless GSD handled the work poorly.

## Lifecycle

Introduce a new `retrospect-milestone` unit type.

The unit runs in two cases:

1. After successful `complete-milestone`, once the local milestone closeout has settled.
2. After auto-mode reaches a milestone-scoped terminal failure, stuck state, or abort before completion.

If no milestone ID can be resolved, the unit should skip and log why. The first implementation should stay milestone-scoped rather than creating project-level retrospectives.

Retrospective failure must not reopen a completed milestone, mark completion failed, or trap auto-mode in a retry loop. Analysis and filing are best-effort. Failures are written to local artifacts and debug logs.

## Local Artifacts

For milestone `M###`, write:

- `.gsd/milestones/M###/M###-RETRO.md`
- `.gsd/milestones/M###/M###-RETRO-ISSUES.json`

`M###-RETRO.md` is the human-readable retrospective. It should include the run outcome, source artifacts analyzed, findings, filing results, and any errors.

`M###-RETRO-ISSUES.json` is the durable idempotency and pending-work record. It maps stable finding fingerprints to GitHub issue numbers or pending issue payloads.

## Finding Model

The model output should be validated into structured findings:

```ts
interface RetrospectiveFinding {
  title: string;
  summary: string;
  category:
    | "bug"
    | "prompt"
    | "workflow-friction"
    | "missing-agent"
    | "automation-idea"
    | "docs"
    | "other";
  severity: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  evidence: string[];
  suggestedFix: string;
  fingerprint: string;
}
```

The filing threshold should intentionally allow false positives. A plausible GSD improvement signal is enough. The dedicated label is the review mechanism.

Valid findings include:

- hard-coded GSD bugs
- bad or ambiguous prompts
- workflow friction
- missing or underpowered agents
- recovery behavior that was confusing or brittle
- automation ideas suggested by the run
- documentation gaps

Ignore findings that are clearly normal user-project work, expected implementation difficulty, or project-specific test failures unless the GSD workflow handled them poorly.

Fingerprints should be deterministic and derived from category, normalized title, and key evidence. They are used to avoid duplicate filing on retries.

## Data Sources

The unit should analyze bounded, milestone-relevant inputs:

- `M###-ROADMAP.md`
- `M###-SUMMARY.md`
- `M###-VALIDATION.md`
- `M###-LEARNINGS.md`
- slice summaries and UAT assessments
- tail-limited `.gsd/activity/*` logs for units in the milestone
- summarized `.gsd/journal/*.jsonl` milestone events
- closeout failures
- verification failures
- stuck-loop or retry markers
- auto-mode terminal reason
- explicit user correction signals visible in activity logs

The collector should summarize large logs before prompting. It should avoid passing large raw JSONL files into the model.

## Prompting Split

The model should only judge and explain. It should produce:

- structured JSON findings
- a short markdown retrospective

The model must not run `gh issue create` or mutate GitHub directly.

Deterministic TypeScript code handles:

- model output validation
- redaction
- fingerprinting
- duplicate checks
- issue body formatting
- label application
- GitHub issue creation
- local artifact persistence

This keeps safety, idempotency, and target-repo enforcement outside freeform model behavior.

## GitHub Filing

Each accepted finding creates one GitHub issue in `skspade/gsd-pi`.

Every created issue must include the primary label, default `gsd-auto-retro`.

The initial configuration shape:

```yaml
retrospective:
  enabled: true
  issue_repo: skspade/gsd-pi
  issue_label: gsd-auto-retro
  max_issues_per_run: 10
```

The implementation should reject or ignore `open-gsd/gsd-pi` as a target. If `issue_repo` is unset, the unit should not file issues.

Issue bodies should include:

- milestone ID
- run outcome: `completed`, `failed`, `stuck`, or `aborted`
- category
- severity
- confidence
- evidence
- suggested fix
- local artifact references
- note that the issue was auto-generated by the milestone retrospective agent

Before filing, check:

1. `M###-RETRO-ISSUES.json`
2. existing GitHub issues with the configured auto-retro label

If duplicate detection is uncertain, file anyway. The user prefers automatic capture and after-the-fact review over missing weak signals.

If filing fails, write the pending issue payload into `M###-RETRO-ISSUES.json` and continue.

## Redaction

Before any GitHub filing, redact:

- absolute paths
- credentials, tokens, and API keys
- environment variable values
- user-project source excerpts

GitHub issues can include GSD artifact names, GSD file names, command names, error summaries, and relative paths where useful. They should not include private local machine paths or project code snippets.

## Error Handling

- If model analysis fails, write `M###-RETRO.md` with the error and skip filing.
- If JSON parsing fails, preserve raw output in `M###-RETRO.md` and skip filing.
- If `gh` is unavailable or unauthenticated, write pending issue payloads locally.
- If the primary label does not exist, attempt to create it. If label creation fails, file without blocking when possible.
- Enforce `max_issues_per_run` to avoid runaway filing.
- Never let retrospective errors block milestone closeout or auto-mode recovery.

## Tests

Add focused tests for:

- successful completion triggers `retrospect-milestone`
- failed or stuck milestone-scoped terminal state triggers `retrospect-milestone`
- no milestone ID means the unit skips cleanly
- one finding creates one issue payload
- retry with the same fingerprints does not duplicate issues
- target repo is `skspade/gsd-pi`, never `open-gsd/gsd-pi`
- redaction strips absolute paths, secrets, and env values
- unavailable `gh` leaves pending local issue payloads
- issue cap is enforced
- malformed model JSON writes a local error artifact and skips filing

## Open Implementation Notes

- Prefer reusing the existing `gh` CLI wrapper from `github-sync`.
- Prefer reusing existing forensics redaction and activity/journal summarization helpers where they are already well-scoped.
- Keep the first implementation simple: one built-in unit, one primary label, one configured repo, one local mapping file.
- Do not add category label creation until the primary label flow is stable.
