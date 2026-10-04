---
name: intent-reviewed-uses-external-worktree
---

# Reviewed intents use their external worktree

`intent-reviewed` splits into an external worktree but reviews and lands from the
operator checkout, risking restoration of unrelated edits and preventing publication.

- Run critic, actuator, verdict handling, boundary enforcement, and deferred landing in
  the split step's external worktree.
- Resolve git-enabled runs under the configured Jarvis root and git-disabled runs from
  their local intent-work path.
- Preserve the operator checkout, including dirty files, throughout reviewed intent runs.
- Publish successfully reviewed intents to the configured durable destination.
- Report the landing failure cause with `invocation_failure` instead of dropping it.
- Cover configured Jarvis roots, git-disabled projects, checkout isolation, successful
  publication, and landing-error propagation.
- Align `v2/docs/first-workflow-walkthrough.md` and `v2/docs/workflow-runner.md` with the
  review cwd, staging, publication, and failure contract.

## Decisions

- Derive review paths through the plan workflow's external-worktree resolution contract, not a separate intent-only path — prevents preset drift.
- Keep split staging and deferred landing unchanged, not relocate output to the operator checkout — preserves the existing workflow boundary.

## Prerequisites

- External worktree resolution honors configured Jarvis roots and git-disabled local paths.
