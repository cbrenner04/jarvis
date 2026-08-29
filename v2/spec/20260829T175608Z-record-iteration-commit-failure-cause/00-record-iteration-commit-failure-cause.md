# Record iteration-commit failure cause on terminal log

## Problem

`iterationCommitFailed` returns `completionCommitError` to its caller but appends a bare terminal `loop_finished` with only `loopOutcomeKind: "iteration_commit_failed"`, so durable run log (`jarvis run log`) cannot explain the boundary-commit failure. Daemon `list`/`wait` projection, TUI log-follow, and resume admission stay unchanged in this slice — see the sibling intent `v2/spec/ready-intents/resume-iteration-commit-failures.md`.

## Surface

`v2/src/execution/write-loop.ts` (`iterationCommitFailed`, `commitRepromptProgressBoundary`, `checkpointBeforeControlledLoss`, and every `checkpointSettledIteration` catch that routes here), `write-loop.test.ts`.

## Decision ledger

- Persist the bounded cause on terminal `loop_finished.message` — rules out `completionCommitError` on the persisted row (`LogLoopFinishedEvent` admits that field only for `completion_commit_failed`).
- Bound the formatted cause with `truncateLogText` — rules out unbounded subprocess output in durable logs.
- Format boundary-commit failures from the thrown error plus available Git stderr via one shared helper — rules out persisting bare `error.message` when stderr carries the diagnosis; omit stderr from the formatted text when it is already contained in `message`.
- When `publicationFailureFor` attaches structured publication evidence to the same `loop_finished` row, `message` carries boundary-commit diagnostic text only — rules out duplicating `publicationFailure` stderr tails in `message`.
- Mirror the same bounded text on `WriteLoopResult.completionCommitError` — rules out divergent caller-observable vs log evidence.
- Leave daemon admission and `composeRunOperatorError` projection unchanged — rules out coupling diagnosis to `resume-iteration-commit-failures` before the cause is observable on the terminal row.

## Task checklist

- Add shared boundary-commit error formatting (error message plus available Git stderr) and use it in `iterationCommitFailed` for both the `loop_finished` append and the returned `completionCommitError`.
- Extend `stops failed when iteration commit throws on progress` to throw an `Error` with a short `message` and a `stderr` string property (git/subprocess failure shape), assert the formatted bounded cause on terminal `loop_finished.message` and matching `result.completionCommitError`, `resumable: true`, no `boundary_committed`, and retained uncommitted authored work; drive oversized `stderr` and assert `truncateLogText` / `INVALID_TOKEN_LOG_MAX_CHARS` ellipsis on `message` (same policy as `contract_miss_detail truncates long invocation output like invalid_token_detail`).
- Pin `// @mutate` directives on the new terminal `message` emission and on the mirrored `completionCommitError` return.
- Update the durable documentation listed below.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` — `stops failed when iteration commit throws on progress` drives a boundary-commit throw as an `Error` with `message` and a `stderr` string property, asserts the formatted bounded cause on terminal `loop_finished.message` and matching `result.completionCommitError`, `resumable: true`, no `boundary_committed`, and the authored worktree change remains uncommitted; it fails against the pre-fix bare terminal record.
- [ ] The same fixture drives oversized `stderr` and asserts `loop_finished.message` is truncated with the same `INVALID_TOKEN_LOG_MAX_CHARS` ellipsis policy as `contract_miss_detail truncates long invocation output like invalid_token_detail`; it fails against the pre-fix bare terminal record.
- [ ] `v2/src/execution/write-loop.test.ts` — `stops failed when iteration commit throws on progress`; Mutation checkpoint: its test body carries `// @mutate v2/src/execution/write-loop.ts "message: truncateLogText(iterationCommitErrorMessage)," -> ""`, removing the added bounded terminal cause and turning the scoped test red.
- [ ] `v2/src/execution/write-loop.test.ts` — `stops failed when iteration commit throws on progress`; Mutation checkpoint: its test body carries `// @mutate v2/src/execution/write-loop.ts "completionCommitError: iterationCommitErrorMessage," -> ""`, removing the mirrored return-path cause and turning the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — record that `iteration_commit_failed` terminal `loop_finished` rows carry a bounded boundary-commit cause (including available Git stderr), retain uncommitted authored work, and emit no `boundary_committed` for the failed iteration; note that daemon list/wait projection, operator-error summary, and resume admission remain deferred to `v2/spec/ready-intents/resume-iteration-commit-failures.md`.
- `v2/docs/v1-behaviors.md` — amend the terminal-evidence bullet so `iteration_commit_failed` is no longer cause-less on durable `loop_finished` rows; it carries optional bounded `message` instead of `completionCommitError`.
