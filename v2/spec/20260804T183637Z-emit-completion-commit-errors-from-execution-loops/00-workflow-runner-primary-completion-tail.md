# Emit completionCommitError on the workflow-runner primary completion tail

## Problem

- The post-review workflow-completion tail returns `completionCommitError` to its caller but appends a `completion_commit_failed` `loop_finished` record without that message.

## Surface

`v2/src/execution/workflow-runner.ts` (three append sites in the primary post-review completion tail: no-commit-SHA dirty ~L958-963, publication failure ~L1061-1069, committer-throw catch ~L1119-1124), `workflow-runner.test.ts`.

## Decisions

- Copy the returned `completionCommitError` into these three primary-tail appends only. Resume settlement (`settleIntentResumeFailure`, `settleReviewMutationResumeFailure`, and their publication-failure appends) is out of scope here — see [01](./01-workflow-runner-resume-settlement.md). Write-loop's own funnel is out of scope here — see [02](./02-write-loop-completion-funnel.md).
- The publication-failure append's `loopOutcomeKind` is `publication.failure.kind`, the full outcome-kind union shared by every publication failure branch (ready gate, ready flip, surviving mutation, completion commit, …). Adding `completionCommitError` requires narrowing to the `completion_commit_failed` case in a branch — a conditional spread onto the shared append object does not narrow the sibling discriminant and will not typecheck against `LogLoopFinishedEvent`.
- `// @mutate` uniqueness: the natural append-side value expression duplicates the adjacent return statement's expression verbatim (e.g. both would read `` `Uncommitted changes: ${namedPaths.join(", ")}` `` or `completionCommitError: message`). Where that would happen, give the append site's expression distinct source text from the return site's — e.g. bind the message to a local once and reference that binding only at the new append site, leaving the pre-existing return-side literal/expression untouched — so each `@mutate` target text stays unique in the file.

## Tasks

- No-commit-SHA dirty append (~L958-963): add `completionCommitError`, matching the value the adjacent return already sets (~L978).
- Committer-throw catch append (~L1119-1124): add `completionCommitError`, matching the value the adjacent return already sets (~L1139).
- Publication-failure append (~L1061-1069): narrow on `publication.failure.kind === "completion_commit_failed"` and add `completionCommitError: publication.failure.error?.message ?? "completion commit failed"` on that branch only (matching the existing return-side fallback ~L1108), leaving the append unchanged for every other outcome kind.
- Extend `does not record done completion boundary when intent stage remains uncommitted` to assert the terminal `loop_finished` record carries the same `completionCommitError` as the workflow result.
- Extend the `commit tail exploded` committer-throw pinning test to assert the terminal `loop_finished` record carries the same `completionCommitError` as the workflow result.
- Add a pinning test that drives a real normalized publication failure through the publication-failure append: use `createCompletionPublisher` with an injected failing `git` push seam (a permanent, non-retryable failure, e.g. `"failed to push some refs to origin"`, per the pattern in `completion-publisher.test.ts`) as the workflow's `completionPublisher`, so the thrown error passes through `runPublicationWithRetry`/`publicationFailureFor`. Assert the terminal `loop_finished` record's `loopOutcomeKind` is `completion_commit_failed` and carries `completionCommitError`.
- Pin a `// @mutate` directive for each of the three added/modified append fields above.
- Amend the existing `v2/docs/workflow-runner.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/v2-architecture.md` bullets that describe `completion_commit_failed` `loop_finished` events (the `v1-behaviors.md` bullet on durable events carrying `completionCommitError`; the matching `v2-architecture.md` observability-log bullet) to record that the workflow-completion tail's three primary sites now emit `completionCommitError` on every append, not merely permit it in the schema. Note resume settlement is amended separately in [01](./01-workflow-runner-resume-settlement.md).

## Acceptance criteria

- [ ] `workflow-runner.test.ts` — committer-throw and no-commit-SHA dirty failures in the primary post-review completion tail log the same `completionCommitError` returned by the workflow; each pinning test's `// @mutate` directive on its corresponding new append field makes its regression fail against baseline.
- [ ] `workflow-runner.test.ts` — a publication `completion_commit_failed` terminal `loop_finished` record, driven by a real normalized publication failure, carries `completionCommitError`; its `// @mutate` directive on the publication-failure append field makes its regression fail against baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — record that the primary post-review completion tail emits `completionCommitError` on its three `completion_commit_failed` append sites.
- `v2/docs/v1-behaviors.md` — amend the existing "durable `completion_commit_failed` `loop_finished` events may carry `completionCommitError`" bullet to state the workflow-completion tail now emits it on these sites (not schema-permission-only).
- `v2/docs/v2-architecture.md` — amend the matching observability-log-stream bullet the same way.
