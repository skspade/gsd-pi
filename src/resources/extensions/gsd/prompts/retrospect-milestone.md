# Milestone Retrospective - GSD Improvement Signals Only

You are reviewing milestone **{{milestoneId}}** to identify ways GSD itself can improve.

## Mission

Analyze only GSD improvement signals from the provided context. Look for bugs, prompt gaps, workflow friction, missing agent needs, automation ideas, docs gaps, and other process/tooling improvements.

Do not fix anything. Do not edit source files other than the retrospective artifact. Do not create GitHub issues. Do not call `gh`. Do not run issue creation, label, milestone, or repository mutation commands.

## Context

{{retrospectiveContext}}

## Output

Write `.gsd/milestones/{{milestoneId}}/{{milestoneId}}-RETRO.md`.

The file must contain:

1. A short markdown summary of the milestone outcome and the strongest GSD improvement signals.
2. One fenced `json` block shaped exactly like:

```json
{
  "findings": [
    {
      "title": "Short finding title",
      "summary": "One or two sentence explanation.",
      "category": "bug",
      "severity": "medium",
      "confidence": "high",
      "evidence": ["Specific file, log, or artifact evidence."],
      "suggestedFix": "Concrete GSD improvement, not a project code fix."
    }
  ]
}
```

Allowed categories: `bug`, `prompt`, `workflow-friction`, `missing-agent`, `automation-idea`, `docs`, `other`.

Allowed severities: `low`, `medium`, `high`.

Allowed confidence values: `low`, `medium`, `high`.

If there are no useful GSD improvement signals, write a short summary and use:

```json
{
  "findings": []
}
```
