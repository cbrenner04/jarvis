# Emit completionCommitError on workflow-runner resume settlement

## Problem

- Intent-resume and review-mutation-resume settlement paths return a failure `message` to their caller but append a `completion_commit_failed` `loop_finished` record without it, reproducing the defect [00](./00-workflow-runner-primary-completion-tail.md) fixes on the primary tail.

## Surface

`v2/src/execution/workflow-runner.ts` (`settleIntentResumeFailure` append ~L2488, intent-resume publication-failure append ~L2606-2613, `settleReviewMutationResumeFailure` append ~L2897-2905, review-mutation-resume publication-failure append ~L3293-3305), `workflow-runner.test.ts`.

## Decisions

- `IntentFinalizationResumeOutcome` and `ReviewMutationResumeOutcome` don't have their own `completionCommitError` field — a caller observes the failure as `{ ok: false, message }`. Copy that same `message` into the matching terminal `loop_finished` append as `completionCommitError`, extending [00](./00-workflow-runner-primary-completion-tail.md)'s fix to the repair/retry/resume paths the intent names.
- `settleIntentResumeFailure` and `settleReviewMutationResumeFailure` are shared helpers invoked with varying `loopOutcomeKind` values (not every caller passes `"completion_commit_failed"`). Guard the new field to the `loopOutcomeKind === "completion_commit_failed"` branch inside each helper.
- The two resume publication-failure appends share [00](./00-workflow-runner-primary-completion-tail.md)'s type-restructure requirement: `loopOutcomeKind: failure.kind` is the outcome-kind union, so `completionCommitError` needs a narrowed `failure.kind === "completion_commit_failed"` branch, not a blind conditional spread.
- `// @mutate` uniqueness: same strategy as [00](./00-workflow-runner-primary-completion-tail.md) — give each append-side expression source text distinct from any sibling return/message expression it would otherwise duplicate verbatim.

## Tasks

- `settleIntentResumeFailure` (~L2488): append `completionCommitError: message` when `loopOutcomeKind === "completion_commit_failed"` (covers the intent-resume committer-throw ~L2550 and no-commit-SHA dirty ~L2557-2565 callers).
- `settleReviewMutationResumeFailure` (~L2897-2905): append `completionCommitError: message` when `loopOutcomeKind === "completion_commit_failed"` (covers the ready-gate repair fence ~L2934-2941, committer-throw ~L2956, and dirty-worktree ~L2961-2968 callers).
- Intent-resume publication-failure append (~L2606-2613): narrow on `failure.kind === "completion_commit_failed"` and add `completionCommitError: failure.error?.message ?? failure.kind` on that branch (matching the existing `message` computed at ~L2598).
- Review-mutation-resume publication-failure append (~L3293-3305): narrow on `failure.kind === "completion_commit_failed"` and add `completionCommitError` the same way (matching the existing `message` computed at ~L3282).
- Add or extend a pinning test driving an intent-resume committer-throw or no-commit-SHA dirty failure, asserting the terminal `loop_finished` record's `completionCommitError` equals the resume outcome's `message`.
- Add or extend a pinning test driving the review-mutation-resume ready-gate repair fence path to a `completion_commit_failed` outcome, asserting the terminal `loop_finished` record's `completionCommitError` equals the resume outcome's `message`.
- Pin a `// @mutate` directive for each of the four added/modified append fields above.
- Amend the same `v2/docs/workflow-runner.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/v2-architecture.md` bullets touched in [00](./00-workflow-runner-primary-completion-tail.md) to extend the emitted-on-every-append statement to intent-resume and review-mutation-resume settlement.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` — an intent-resume committer-throw or no-commit-SHA dirty failure logs the same `completionCommitError` as the resume outcome's `message`; its `// @mutate` directive on the `settleIntentResumeFailure` append field makes its regression fail against baseline.
- [ ] `workflow-runner.test.ts` — a review-mutation-resume ready-gate repair fence failure logs the same `completionCommitError` as the resume outcome's `message`; its `// @mutate` directive on the `settleReviewMutationResumeFailure` append field makes its regression fail against baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — record that intent-resume and review-mutation-resume settlement now emit `completionCommitError` on every `completion_commit_failed` append, completing the workflow-completion-tail statement started in [00](./00-workflow-runner-primary-completion-tail.md).
- `v2/docs/v1-behaviors.md` — extend the same bullet amended in [00](./00-workflow-runner-primary-completion-tail.md) to cover resume settlement.
- `v2/docs/v2-architecture.md` — extend the same bullet amended in [00](./00-workflow-runner-primary-completion-tail.md) to cover resume settlement.
