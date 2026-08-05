# Emit completionCommitError on the write-loop completion funnel

## Problem

- The write loop returns `completionCommitError` to its caller but appends a `completion_commit_failed` `loop_finished` record without that message.

## Surface

`v2/src/execution/write-loop.ts` (`completionCommitFailed` ~L2564-2588, the single funnel every write-loop publication, repair, retry, and resume `completion_commit_failed` path routes through), `write-loop.test.ts`.

## Decisions

- `completionCommitFailed` is called from every write-loop completion-tail site (fresh-run publication ~L731/762-763/788/815, resumed-run publication ~L1233-1234/1259/1286, and the no-agent short-circuit ~L1192) — one fix in the helper covers the whole family the intent calls "repair, retry, and resume paths."
- Add `completionCommitError: error?.message ?? "completion commit failed"` to the helper's `loop_finished` append, mirroring the identical fallback expression already used in its return value (~L2585). This settles the no-underlying-error call path (~L1192, called with no `error`): the log mirrors the same synthetic `"completion commit failed"` fallback the return already carries, keeping the log and the returned result in parity rather than letting that path recreate the defect.
- `// @mutate` uniqueness: the append-side and return-side expressions would be identical text if copied verbatim. Give the append-side expression distinct source text from the return-side expression it would otherwise duplicate — e.g. bind the fallback message to a local once and reference that binding only at the new append site, leaving the pre-existing return-side expression untouched — so the `@mutate` target text stays unique in the file.
- The sibling `iterationCommitFailed` helper (`iteration_commit_failed` outcome, ~L2751-2779) is out of scope: `LogLoopFinishedEvent` in `v2/src/persistence/log-stream.ts` admits `completionCommitError` only on the `completion_commit_failed` literal variant of the discriminated union, so no equivalent field can be added there.
- The dual-field acceptance criterion (`completionCommitError` + `publicationFailure` together) is scoped and tested here, not in [00](./00-workflow-runner-primary-completion-tail.md): `completionCommitFailed`'s existing `publicationFailure = error === undefined ? undefined : publicationFailureFor(error)` (~L2571) already resolves real normalized evidence when `error` passed through `runPublicationWithRetry` (reachable via the fresh-run publication-failure branch ~L762-763, whose `error` comes from `publishWithReadyRepair` → the real `completionPublisher`). The existing `returns retryable completion_commit_failed when pushed without PR evidence` test drives a synthetic path outside `runPublicationWithRetry` and cannot exercise this — do not extend it for the dual-field claim; add a new test instead.

## Tasks

- `completionCommitFailed`: add `completionCommitError` to the `loop_finished` append per the Decisions above.
- Extend `returns retryable completion_commit_failed when pushed without PR evidence` to assert the terminal `loop_finished` record carries the same `completionCommitError` as the write-loop result (`result.completionCommitError`).
- Extend at least one ready-gate repair fence pinning test that reaches a `completion_commit_failed` outcome to assert the terminal `loop_finished` record carries the same `completionCommitError` as the write-loop result.
- Add a pinning test that drives a real normalized publication failure through the fresh-run publication branch: run the write loop without injecting `completionPublisher`, instead injecting `createCompletionPublisher` with a failing `git` push seam (a permanent, non-retryable failure, e.g. `"failed to push some refs to origin"`, per the pattern in `completion-publisher.test.ts`), so the thrown error passes through `runPublicationWithRetry`/`publicationFailureFor`. Assert the terminal `loop_finished` record carries both `completionCommitError` and `publicationFailure`.
- Pin a `// @mutate` directive for the `completionCommitFailed` append field.
- Amend the existing `v2/docs/write-behavior.md` entry describing write-loop publication/completion logging to record that `completionCommitFailed` now emits `completionCommitError` on every append. Amend the same `v2/docs/v1-behaviors.md` and `v2/docs/v2-architecture.md` bullets touched in [00](./00-workflow-runner-primary-completion-tail.md)/[01](./01-workflow-runner-resume-settlement.md) to finalize the statement across both execution loops, and note the `iteration_commit_failed` exclusion.

## Acceptance criteria

- [x] `write-loop.test.ts` — completion-publication and repair-path failures log the same `completionCommitError` returned by the write loop; each pinning test's `// @mutate` directive on the `completionCommitFailed` append field makes its regression fail against baseline.
- [x] `write-loop.test.ts` — a publication `completion_commit_failed` terminal `loop_finished` record, driven by a real normalized publication failure, retains both `completionCommitError` and `publicationFailure`; its `// @mutate` directive on the `completionCommitFailed` append field makes its regression fail against baseline.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — record that the write-loop completion funnel emits `completionCommitError` on every `completion_commit_failed` append (publication, repair, retry, and resume paths).
- `v2/docs/v1-behaviors.md` — finalize the bullet amended in [00](./00-workflow-runner-primary-completion-tail.md)/[01](./01-workflow-runner-resume-settlement.md): both execution loops now emit `completionCommitError` on every `completion_commit_failed` append; `iteration_commit_failed` is excluded by the log-event type.
- `v2/docs/v2-architecture.md` — finalize the matching observability-log-stream bullet the same way.
