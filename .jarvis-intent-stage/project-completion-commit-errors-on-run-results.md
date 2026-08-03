---
name: project-completion-commit-errors-on-run-results
---

# Project completion-commit errors on run results

## Module-boundary surface

- Daemon: durable terminal-log composition for `list` and `wait` results.

## Problem

- Daemon operator errors map `completion_commit_failed` to a reason and action but omit the generic message stored on its terminal log event.

## Decisions

- Project terminal `completionCommitError` onto the `RunOperatorError` returned by both `list` and `wait` — rules out separate command-specific lookups.
- Preserve `publicationFailure` beside `completionCommitError` — rules out losing structured operation, exit-code, and output-tail evidence.
- Use the existing terminal-record and workflow-owner selection rules — rules out a second error-precedence path for workflow entry rows.

## Acceptance criteria

- [ ] `run-operator-error.test.ts` maps a persisted `completion_commit_failed` message to `error.completionCommitError` while retaining any `publicationFailure`; the regression fails against baseline.
- [ ] `daemon-wait-run-completion.test.ts` proves `list` and `wait`, including a workflow entry whose stopping sibling owns the failure, return the same underlying completion-commit message; the regression fails against baseline.
- [ ] Added or modified guards carry `// @mutate` directives on their real source conditions; named pinning tests turn red under each mutation and no production inversion hook is added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document `error.completionCommitError` on `list` and `wait` and its coexistence with `publicationFailure`.
- `v2/docs/v1-behaviors.md` — record the v2 daemon projection change.

## Prerequisites

- Durable `completion_commit_failed` `loop_finished` records can retain optional `completionCommitError` text without a `runs` table migration.
- Every execution-loop completion-commit failure writes the returned message to its terminal `loop_finished` record while preserving normalized publication evidence.
