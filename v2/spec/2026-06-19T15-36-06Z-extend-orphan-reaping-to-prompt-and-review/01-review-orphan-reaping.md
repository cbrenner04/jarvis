# Review-pass orphan reaping

## Problem

Review passes (`v1/src/modes/patch/review.ts`) spawn agents through the same
detached process-group path as the patch loop. Two spawn sites — the read-only
reviewer pass wrapped by `withReviewPassTimeout`, and the verdict-actuator
invocation — can leak orphans re-parented to init (PPID=1) that escape the
watchdog's `-pgid` kill. The `DescendantTracker` reap is wired only into the
patch loop, so these review invocations leave orphans behind.

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
- Source the poll interval from the single shared location introduced for
  prompt/patch rather than copying the literal.

## Task checklist

- [ ] Instantiate a `DescendantTracker` at the reviewer-pass spawn
  (`withReviewPassTimeout`'s `onSpawned`) and at the verdict-actuator spawn;
  poll on spawn then on an interval (unref the handle).
- [ ] Clear the poll interval and reap in each invocation's `finally`, wrapped
  so throws are swallowed.
- [ ] Expose a test-only reap override so the non-fatal guarantee is testable.
- [ ] Update docs.

## Acceptance criteria

- [ ] A review-pass invocation whose agent left a re-parented orphan (PPID=1,
  recorded while its lineage was intact) SIGKILLs that orphan when the pass
  ends.
- [ ] A verdict-actuator invocation reaps a re-parented orphan its agent left
  behind when the invocation ends.
- [ ] A reap failure during a review invocation does not change the review
  outcome or exit code.
- [ ] `bun run typecheck` and `bun test` pass; existing review tests still pass.

## Documentation updates

- `v1/docs/run-loop.md`: extend the orphan-reaping note to cover review-pass and
  verdict-actuator invocations.
- `v2/docs/v1-behaviors.md`: record that review-pass and verdict-actuator
  invocations reap re-parented agent orphans (cite `v1/src/modes/patch/review.ts`).
