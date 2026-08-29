---
name: implement-boundary-commit-failure-strands-authored-work
---

# An implement iteration whose boundary commit fails strands correct authored work with no supported recovery

## Problem

A standalone `run workflow implement` iteration authors correct, complete work in its worktree, then its boundary commit fails: the write loop records `loopOutcomeKind: iteration_commit_failed` with `resumable: true` (`v2/src/execution/write-loop.ts:3803` `iterationCommitFailed`), but the daemon's resume admission then projects the run's operator error as `reason: unsupported_resume_context`, `retryable: false`, `nextAction: stop` (`v2/src/daemon/daemon.ts:698`). So:

- The authored changes stay **uncommitted** in the worktree (the boundary commit never landed).
- `jarvis run resume` is **refused** (`unsupported_resume_context`), contradicting both the loop's own `resumable: true` and the operator-error recovery copy for `iteration_commit_failed` (`run-operator-error.ts:308`: "fix git state, then jarvis run resume").
- The only recovery is an operator hand-salvage: verify the uncommitted diff, commit it by hand, and continue the remaining subspecs manually.

Observed twice this session, both standalone `implement --base main`, both leaving correct work uncommitted:

- `missing-ready-gate-command-settles-without-repair` implement (run `d0a3c73d`) — all edits present, hand-committed and merged as #3047.
- `deferred-settlement-resume-preserves-pr-evidence` implement (run `6d65ef20`) — subspec 00's edits present and green (typecheck + new tests pass), hand-committed to the branch; subspec 01 never started.

Not universal and not contention: the `markdown-only-stages-skip-the-ready-gate` implement (run `b79f3565`, same session, same conditions) committed and self-published cleanly; the two failures were not concurrent with the successes.

The underlying boundary-commit error is not surfaced in the run log (only `loop_finished` is recorded), so the first task is to capture why the commit fails before deciding the fix.

## Decisions

- Surface the boundary-commit failure cause: the `error` passed to `iterationCommitFailed` must be recorded on the terminal `loop_finished`/operator error (message + git stderr excerpt) so the operator and any recovery path can see why the commit failed, instead of a bare `iteration_commit_failed`. Rules out diagnosing from an empty log.
- Reconcile the `resumable: true` / `unsupported_resume_context` contradiction: an `iteration_commit_failed` run whose worktree carries the authored, uncommitted changes must be resumable through the ordinary resume path (its own recovery copy already promises this), OR the failed boundary commit must be retried/committed in-band so the work is not stranded. Rules out advertising `resumable: true` while the daemon refuses resume with `nextAction: stop`.
- Do not discard the authored worktree changes on an `iteration_commit_failed`: retirement/re-run of the stranded run must preserve (not `git reset`/clean away) the uncommitted work until it is recovered. Rules out losing correct authored work to an automatic cleanup.

## Acceptance criteria

- [ ] An `iteration_commit_failed` terminal record carries the boundary-commit error message (and a bounded git-stderr excerpt) — pinned by a write-loop test that fails a boundary commit with a known error and asserts the message is on the settled record (fails against the current bare `iteration_commit_failed`).
- [ ] A run that settled `iteration_commit_failed` with authored uncommitted changes in its worktree is admitted by `jarvis run resume` (or an equivalent in-band commit-retry lands the work), instead of `unsupported_resume_context` / `nextAction: stop` — pinned by a daemon resume-admission test seeding that state (fails today).
- [ ] Re-running or retiring the stranded run does not discard the uncommitted authored changes before they are recovered — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery for an implement `iteration_commit_failed`: the boundary-commit cause is now named; the run is resumable (or the salvage path if not); the worktree changes are preserved.
- `v2/docs/write-behavior.md` — boundary-commit failure records its cause and keeps the authored work recoverable.
