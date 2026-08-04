# Emit completionCommitError on terminal loop_finished

## Problem

- Execution paths return `completionCommitError` to their caller but append a `completion_commit_failed` `loop_finished` record without that message.

## Surface

`v2/src/execution/workflow-runner.ts`, `v2/src/execution/write-loop.ts`, `workflow-runner.test.ts`, `write-loop.test.ts`.

## Decisions

- Copy the returned `completionCommitError` into every terminal `completion_commit_failed` `loop_finished` append — rules out caller-only diagnostics.
- Workflow completion tail: no-commit-SHA dirty, committer-throw catch, and publication `completion_commit_failed` append sites — rules out fixing only the initially observed workflow tail.
- Write-loop finalization: central `completionCommitFailed` and every repair/retry/resume caller — rules out write-loop-only or tail-only fixes.
- Retain normalized `publicationFailure` beside `completionCommitError` when available — rules out replacing structured publication evidence with message-only detail.

## Tasks

- `workflow-runner.ts`: add `completionCommitError` to each `completion_commit_failed` `loop_finished` append (no-commit-SHA dirty, committer-throw catch, publication-failure append when outcome is `completion_commit_failed`).
- `write-loop.ts`: add `completionCommitError` to `completionCommitFailed` log append (covers publication, repair, retry, and resume paths that route through it).
- `workflow-runner.test.ts`: extend `does not record done completion boundary when intent stage remains uncommitted` and `commit tail exploded` (or equivalent committer-throw pinning test) to assert the terminal `loop_finished` record carries the same `completionCommitError` as the workflow result; add or extend a publication `completion_commit_failed` pinning test that asserts both `completionCommitError` and `publicationFailure` on the terminal event when publication normalization applies.
- `write-loop.test.ts`: extend `returns retryable completion_commit_failed when pushed without PR evidence` and at least one ready-gate repair fence pinning test to assert terminal `loop_finished` carries the same `completionCommitError` as the write-loop result; add or extend a publication-failure pinning test asserting both fields when normalized publication evidence exists.
- Pin `// @mutate` directives (each target text occurs exactly once in the named file):
  - Workflow dirty tail: mutate the new `completionCommitError` field on the no-commit-SHA `loop_finished` append.
  - Workflow committer throw: mutate the new `completionCommitError` field on the catch-path `loop_finished` append.
  - Workflow publication failure: mutate the new `completionCommitError` field on the publication-failure `loop_finished` append when outcome is `completion_commit_failed`.
  - Write loop: mutate the new `completionCommitError` field on the `completionCommitFailed` `loop_finished` append.
- Update `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` — committer-throw and no-commit-SHA dirty failures log the same `completionCommitError` returned by the workflow; each pinning test's `// @mutate` directive on the corresponding new append field makes its regression fail against baseline.
- [ ] `write-loop.test.ts` — completion publication and repair-path failures log the same `completionCommitError` returned by the write loop; each pinning test's `// @mutate` directive on the `completionCommitFailed` append field makes its regression fail against baseline.
- [ ] `workflow-runner.test.ts` or `write-loop.test.ts` — a publication `completion_commit_failed` terminal `loop_finished` retains both `completionCommitError` and normalized `publicationFailure`; the publication pinning test's `// @mutate` directive on the workflow publication-failure append field makes its regression fail against baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — workflow-completion tail `loop_finished` records carry `completionCommitError` on every `completion_commit_failed` path.
- `v2/docs/write-behavior.md` — write-loop publication and repair terminal logs carry `completionCommitError` beside existing `publicationFailure` when present.
- `v2/docs/v1-behaviors.md` — execution loops emit `completionCommitError` on terminal `completion_commit_failed` log events (not schema-only).
