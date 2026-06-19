# Review-pass orphan reaping

## Problem

Review passes (`v1/src/modes/patch/review.ts`) spawn agents through the same
detached process-group path as the patch loop. Two spawn sites — the read-only
reviewer pass wrapped by `withReviewPassTimeout`, and the verdict-actuator
invocation — can leak orphans re-parented to init (PPID=1) that escape the
watchdog's `-pgid` kill. The `DescendantTracker` reap is wired only into the
patch loop, so these review invocations leave orphans behind.

Depends on subspec 00, which relocates the shared poll-interval constant to
`reap.ts`; this subspec consumes that export and so is not independent of 00.

Review runs as a separate phase after the patch iteration's `finally` has
cleared its tracker handle and reaped, so the patch tracker is idle during
review and per-invocation review trackers do not overlap it (reap is per-PID and
identity-guarded, so overlap would be benign regardless).

## Decisions

- Reuse `DescendantTracker` from `v1/src/modes/patch/reap.ts`; do not fork a
  review-specific reaper. Rules out a divergent second implementation.
- Cover both review spawn sites — the reviewer pass and the verdict actuator —
  since both detach into their own process group. Rules out reaping only the
  reviewer pass and leaving actuator orphans.
- Reap per invocation: each spawn gets a tracker that polls on spawn + interval
  and reaps in that invocation's `finally`. Rules out a single review-spanning
  tracker.
- Poll on `onSpawned` then on a fixed interval (the shared cadence), so escapees
  are recorded while their lineage is intact.
- Best-effort and non-fatal: a reap (or poll) throw is swallowed and never
  alters review pass outcome, verdict handling, or exit codes. Rules out letting
  reap errors surface.
- Source the poll interval from the `reap.ts` export introduced by subspec 00
  rather than copying the literal.
- Home the test-only reap override on the review phase-options object that both
  spawn sites reach in lexical scope. `withReviewPassTimeout` currently takes no
  options object, so its signature grows to receive the override (and the
  per-invocation tracker). Naming one shared home rules out two divergent
  override seams across the two sites.
- The actuator path already captures its process-group id (currently unused);
  this work converts that latent capture into the tracker's poll root rather
  than adding capture from scratch.

## Task checklist

- [ ] Instantiate a `DescendantTracker` at the reviewer-pass spawn
  (`withReviewPassTimeout`'s `onSpawned`) and at the verdict-actuator spawn;
  poll on spawn then on an interval (unref the handle).
- [ ] Clear the poll interval and reap in each invocation's `finally`, wrapped
  so throws are swallowed.
- [ ] Add a test-only reap override on the review phase-options object; grow
  `withReviewPassTimeout`'s signature to take an options object carrying the
  override and per-invocation tracker.
- [ ] Update docs.

## Verification

Real-kill behavior is covered by the existing `DescendantTracker` unit tests;
injecting the reap override replaces the real reap, so the seam cannot exercise
a real kill. New review tests use the override to assert the wiring at both
spawn sites — polling on spawn + interval, reap invoked in `finally`, and
non-fatality.

## Acceptance criteria

- [x] The reviewer pass polls the tracker on spawn and on the interval and
  invokes reap in its `finally`, observed via the injected reap override.
- [x] The verdict actuator polls the tracker on spawn and on the interval and
  invokes reap in its `finally`, observed via the injected reap override.
- [x] A reap failure during a review invocation does not change the review
  outcome or exit code.
- [x] `bun run typecheck` and `bun test` pass; existing review tests still pass.

## Documentation updates

- `v1/docs/run-loop.md`: extend the orphan-reaping note to cover review-pass and
  verdict-actuator invocations.
- `v2/docs/v1-behaviors.md`: record that review-pass and verdict-actuator
  invocations reap re-parented agent orphans (cite `v1/src/modes/patch/review.ts`).
