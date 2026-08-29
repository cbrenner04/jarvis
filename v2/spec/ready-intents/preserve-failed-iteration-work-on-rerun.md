---
name: preserve-failed-iteration-work-on-rerun
---

# Incomplete re-runs preserve failed iteration work

## Prerequisites

- The `record-iteration-commit-failure-cause` behavior is implemented: an `iteration_commit_failed` terminal record carries a bounded boundary-commit error message and available Git stderr while preserving the authored uncommitted work.
- The `resume-iteration-commit-failures` behavior is implemented: a failed standalone implement row with a valid persisted write snapshot is admitted through ordinary resume, and list/wait project `iteration_commit_failed` as retryable and resumable.

## Problem

- The incomplete-workflow stale reset can retire a dirty worktree when `--reset-despite-dirty` is supplied, discarding authored changes left by `iteration_commit_failed` before the supported resume path recovers them.

## Behavior

- Automatic incomplete re-run retirement refuses to remove a matching `iteration_commit_failed` worktree while its authored changes remain uncommitted, including when the generic dirty-worktree override is supplied.
- After the failed iteration is recovered and the worktree is clean, existing stale-retirement behavior remains available.

## Decisions

- Make failed-iteration authored work a non-overridable automatic stale-reset guard; rules out treating `--reset-despite-dirty` as authority to discard a known recoverable checkpoint failure.
- Scope the guard to a matching durable `iteration_commit_failed` row plus a dirty managed worktree; rules out blocking unrelated dirty-worktree overrides or clean recovered branches.
- Leave explicit manual abandonment outside this automatic re-run guard; rules out silently redefining the operator's deliberate destructive cleanup command.

## Acceptance criteria

- [ ] A stale-reset CLI test seeds a matching `iteration_commit_failed` row and dirty authored file, invokes incomplete implement re-run with `--reset-despite-dirty`, and asserts refusal plus unchanged file, worktree, and branch; it fails against the current override path.
- [ ] `v2/src/commands/workflow.test.ts` — `run workflow implement refuses iteration_commit_failed worktree despite reset-despite-dirty`; Mutation checkpoint: its test body carries `// @mutate v2/src/commands/cleanup.ts "if (preserveFailedIterationWork) {" -> "if (false) {"`, disabling the added matching-failed-row guard, restoring retirement, and turning the scoped test red.
- [ ] A recovered clean worktree and unrelated failure rows retain existing stale-retirement behavior, pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the non-overridable automatic-retirement guard and resume-first recovery.
- `v2/docs/v1-behaviors.md` — record the corrected existing stale re-run behavior.
