# Render completion-commit errors in CLI

## Problem

`composeRunOperatorError` already surfaces `error.completionCommitError` on daemon
`list` / `wait` rows for terminal `completion_commit_failed` records. `formatListRunRow`
does not render it, and `run.test.ts` does not pin `jarvis run wait` stdout for the
field — operators cannot read the generic completion-commit message from CLI output.

## Decision ledger

- Append one trailing `completionCommitError` column after `prUrl`, `-` when absent — rules out shifting existing columns or inserting mid-row.
- Column value is `JSON.stringify(error.completionCommitError)` — rules out raw embedding that breaks TSV row boundaries on tabs or newlines.
- `jarvis run wait` keeps passing the daemon `error` object verbatim via `buildWaitPayload` — rules out a closed allowlist that drops `completionCommitError`.
- `publicationFailure` column rendering stays unchanged — rules out replacing structured publication diagnostics with the generic message.
- Owning-run id semantics match daemon projection (sibling `~shrink`, not workflow entry) — rules out CLI-side re-lookup or re-normalization.

## Prerequisites

- [`20260804T202247Z-project-completion-commit-errors-on-run-results`](../20260804T202247Z-project-completion-commit-errors-on-run-results/index.md) merged — daemon `list` / `wait` expose `error.completionCommitError`.

## Task checklist

- Extend `formatListRunRow` with the trailing JSON-encoded column.
- Add `run.test.ts` regressions for `run list` (present, absent, tab/newline message) and `run wait` (`completion_commit_failed` with `error.completionCommitError`).
- Update operator and CLI contract docs; record v2 parity delta.

## Acceptance criteria

- [ ] `run.test.ts` regression drives `run wait` with a `completion_commit_failed` daemon result carrying `error.completionCommitError` and asserts minified stdout includes that field under `error`; fails against baseline CLI formatting.
- [ ] `run.test.ts` regression drives `run list` with `error.completionCommitError` present and pins the trailing column to `JSON.stringify(message)` appended after `prUrl` without shifting earlier column indices; fails against baseline CLI formatting.
- [ ] `run.test.ts` regression drives `run list` with `error.completionCommitError` absent and asserts the trailing column renders `-`; fails against baseline CLI formatting.
- [ ] `run.test.ts` regression drives `run list` with a `completionCommitError` containing tab and newline characters and asserts one physical stdout row with the message confined to the trailing column; fails against baseline CLI formatting.
- [ ] `run.test.ts` links a `// @mutate` directive in each pinning test above to every added or modified guard's real source condition in `v2/src/commands/run.ts` or `v2/src/cli/run-completion.ts`; each mutation turns its test red with no production inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completion-commit diagnostics: read `error.completionCommitError` from `jarvis run wait` / the trailing `run list` column (and `jarvis run log` for full context); drop daemon-process-log guidance for this failure class.
- `v2/docs/write-behavior.md` — document the appended `run list` column and `error.completionCommitError` on `run wait` stdout.
- `v2/docs/v1-behaviors.md` — v2 CLI observability delta for `completionCommitError` rendering.
