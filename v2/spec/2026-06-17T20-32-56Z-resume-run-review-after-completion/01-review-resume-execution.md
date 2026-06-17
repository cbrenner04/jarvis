# Review-resume execution path

When `jarvis1 run --resume-review` passes its guards (subspec 00), drive the
existing post-completion review phase against the already-complete spec without
running implementation agents, and retry the normal review-to-ready path.

## Problem

The review phase is reached only through `tryFinishSpecIfDone`, which runs the
review phase only when `implementationIterations > 0`
(`v1/src/modes/patch/run.ts`). For an already-complete spec, the only live
entry to that completion path is the zero-unchecked branch of `runIteration`
(`before === 0` → `tryFinishSpecIfDone`); the post-iteration completion entry is
unreachable because no implementation iteration runs. A resumed completed spec
therefore performs zero implementation iterations and the existing gate skips
both review and shrink. Review resume must bypass that specific gate for review
only, at that single live entry, while leaving normal (non-resume) completion
behavior unchanged.

## Decisions

- Review resume enters the review phase directly on an already-complete spec
  (zero unchecked tasks) by treating the `implementationIterations > 0`
  condition as satisfied **for the review phase only, and only when review
  resume is active**, at the zero-iteration completion entry. Rules out:
  lowering that gate for normal runs, which would make ordinary checkbox-only
  completions trigger review against an empty diff. The gate is unchanged for
  non-resume runs.
- Review resume reuses the existing review readiness path (baseline gate →
  review passes → final ready / `gh pr ready`) and the existing draft
  PR/worktree. Rules out opening a new PR or worktree per resume.
- The post-completion shrink phase does not run under review resume: shrink is
  gated on at least one implementation iteration and there is no run-scoped
  implementation diff to shrink. Rules out shrinking unrelated prior-commit
  changes. (The shrink gate itself is unchanged; review resume does not flip
  it.)
- Review resume preserves every existing review-phase outcome unchanged:
  baseline-gate failure and final-gate failure (non-zero exit), review blocker
  (exit `7`), and review quota exhaustion (exit `2`). Gate failure is a
  first-class path here, not an edge case: resume's purpose is to *retry*, and a
  resumed worktree is more likely to fail the gate (base moved, deps drifted).
  Rules out treating gate failure as an unexpected crash.
- Re-running `--resume-review` against an already-ready PR is idempotent: the
  final gate's `gh pr ready` leaves an already-ready PR untouched and the resume
  exits cleanly, matching the established idempotent-ready precedent (plan-mode
  ready transition). Rules out a hard error or duplicate ready churn when an
  operator retries review after a prior successful run.

## Tasks

- In the zero-iteration completion path (`tryFinishSpecIfDone`), when review
  resume is active, run the review phase regardless of implementation-iteration
  count, and keep the shrink phase skipped.
- Preserve existing review-phase exits: baseline/final-gate failure (non-zero),
  blocker (`7`), and quota exhaustion (`2`) behave as in a normal
  post-completion review.
- Ensure that against an already-ready PR, the final ready transition is a
  clean no-op (idempotent) rather than an error.

## Acceptance criteria

- [ ] `jarvis1 run --resume-review` on a complete spec (zero unchecked tasks) with `git: true` and review passes > 0 runs the post-completion review phase and invokes no implementation agent.
- [ ] A successful review resume retries the review-to-ready path and transitions the existing draft PR to ready, without opening a new PR or worktree.
- [ ] Review resume reuses the existing review-phase stop semantics: a review blocker still stops with the review blocker exit (`7`), and review quota exhaustion still exits with the quota exit (`2`).
- [ ] A review-resume run whose baseline or final ready gate fails exits non-zero (the review phase's gate-failure exit) and does not transition the PR to ready.
- [ ] `jarvis1 run --resume-review` against an already-ready PR exits cleanly and leaves the ready PR untouched (idempotent).
- [ ] A normal (non-`--resume-review`) `jarvis1 run` on an already-complete spec still exits `0` with `spec complete` and does not enter the review phase.
- [ ] The post-completion shrink phase does not run under `--resume-review` (no `patch_phase: "shrink"` telemetry row is emitted for a review-resume run).
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: in the "Review phase" section, document that review
  resume enters review at the zero-iteration completion path, treats the
  implementation-iteration gate as satisfied for review only, keeps shrink
  skipped, reuses the baseline → passes → final-ready flow, preserves
  blocker/quota/gate-failure exits, and is idempotent against an already-ready
  PR.
- `v2/docs/v1-behaviors.md`: extend the "Patch-mode review phase" and
  "Patch-mode post-completion shrink" entries to record the review-resume
  behavior (review runs with zero implementation iterations; shrink stays
  skipped) and that gate failure / blocker / quota exits and already-ready
  idempotency are preserved.
