# Review-resume execution path

When `jarvis1 run --resume-review` passes its guards (subspec 00), drive the
existing post-completion review phase against the already-complete spec without
running implementation agents, and retry the normal review-to-ready path.

## Problem

The review phase is reached only through `tryFinishSpecIfDone`, which runs the
review phase only when `implementationIterations > 0`
(`v1/src/modes/patch/run.ts`). A resumed completed spec performs zero
implementation iterations, so the existing gate skips review. Review resume must
bypass that specific gate while leaving the normal (non-resume) completion
behavior unchanged.

## Decisions

- Review resume enters the review phase directly on an already-complete spec
  (zero unchecked tasks) and bypasses the `implementationIterations > 0` gate
  for the review phase only. Rules out: lowering that gate for normal runs,
  which would make ordinary checkbox-only completions trigger review against an
  empty diff.
- Review resume runs no implementation agent and asserts the spec is already
  complete; if unchecked tasks remain it is an operator error (non-zero exit),
  not a fall-through into implementation. Rules out silently implementing the
  spec under a flag whose contract is review-only.
- Review resume reuses the existing review readiness path (baseline gate →
  review passes → final ready / `gh pr ready`) and the existing draft
  PR/worktree, including idempotent ready transition. Rules out opening a new PR
  or worktree per resume.
- The post-completion shrink phase does not run under review resume, since
  shrink is itself gated on at least one implementation iteration and there is
  no run-scoped implementation diff to shrink. Rules out shrinking unrelated
  prior-commit changes.

## Tasks

- In the patch run completion path, when review resume is active, run the review
  phase against the complete spec regardless of implementation-iteration count,
  and skip the implementation loop and shrink phase.
- Preserve existing review-phase outcomes: blocker exit, quota exhaustion exit,
  and successful ready transition behave as in a normal post-completion review.
- Ensure a resumed review against a spec with remaining unchecked tasks exits
  non-zero with an operator-facing message rather than invoking an
  implementation agent.

## Acceptance criteria

- [ ] `jarvis1 run --resume-review` on a complete spec (zero unchecked tasks) with `git: true` and review passes > 0 runs the post-completion review phase and invokes no implementation agent.
- [ ] A successful review resume retries the review-to-ready path and transitions the existing draft PR to ready, without opening a new PR or worktree.
- [ ] Review resume reuses the existing review-phase stop semantics: a review blocker still stops with the review blocker exit, and review quota exhaustion still exits with the quota exit.
- [ ] `jarvis1 run --resume-review` on a spec that still has unchecked tasks exits non-zero with an operator-facing message and invokes no implementation agent.
- [ ] A normal (non-`--resume-review`) `jarvis1 run` on an already-complete spec still exits `0` with `spec complete` and does not enter the review phase.
- [ ] The post-completion shrink phase does not run under `--resume-review`.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: in the "Review phase" section, document that review
  resume bypasses the implementation-iteration gate, skips shrink, and reuses
  the baseline → passes → final-ready flow; note unchecked-tasks rejection.
- `v2/docs/v1-behaviors.md`: extend the "Patch-mode review phase" and
  "Patch-mode post-completion shrink" entries to record the review-resume
  behavior (review runs with zero implementation iterations; shrink stays
  skipped) and the unchecked-tasks rejection.
