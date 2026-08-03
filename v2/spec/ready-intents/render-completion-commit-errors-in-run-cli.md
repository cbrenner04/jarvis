---
name: render-completion-commit-errors-in-run-cli
---

# Render completion-commit errors in run CLI output

## Module-boundary surface

- CLI: `jarvis run list` tabular output and `jarvis run wait` JSON output.

## Problem

- The CLI cannot show a generic completion-commit message even when daemon run results carry operator-error detail.

## Decisions

- Preserve `error.completionCommitError` in `run wait` JSON — rules out reducing the daemon error object to closed reason fields.
- Append one JSON-encoded `completionCommitError` column to `run list`, using `-` when absent — rules out shifting existing columns or allowing tabs and newlines to corrupt row boundaries.
- Keep `publicationFailure` output unchanged — rules out making the generic message replace structured publication diagnostics.

## Acceptance criteria

- [ ] `run.test.ts` proves `run wait` prints `error.completionCommitError` for `completion_commit_failed`; the regression fails against baseline daemon projection.
- [ ] `run.test.ts` proves `run list` appends the JSON-encoded message without shifting existing columns and prints `-` when absent; the regression fails against baseline CLI formatting.
- [ ] Messages containing tabs or newlines remain within one `run list` column and one physical output row.
- [ ] `run.test.ts` links a `// @mutate` directive in each pinning test to every added or modified guard's real source condition; each mutation turns its test red and adds no production inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — direct operators to `run log`, `run wait`, and `run list` for completion-commit diagnostics; remove daemon instrumentation guidance.
- `v2/docs/write-behavior.md` — add the `run list` column and `run wait` error field to the CLI contract.
- `v2/docs/v1-behaviors.md` — record the v2 CLI observability change.

## Prerequisites

- Durable `completion_commit_failed` `loop_finished` records can retain optional `completionCommitError` text without a `runs` table migration.
- Every execution-loop completion-commit failure writes the returned message to its terminal `loop_finished` record while preserving normalized publication evidence.
- Daemon `list` and `wait` project the durable message as `error.completionCommitError` under existing terminal-record and workflow-owner precedence.
