---
name: completion-ready-red-loopback
---

**Scope.** This intent lives under `v2/spec/` for plan-mode routing only.
Implementation is v1 harness work — `v1/src/modes/patch/run.ts` (completion
transition / iteration loop), `v1/src/modes/patch/review.ts` (baseline gate
relationship), `v1/docs/**`, `v2/docs/v1-behaviors.md`. Not v2/`v2/src`.

# Red completion `ready` loops back instead of erroring the run

## Problem

When `ready` is red at the completion transition, the run reaches a
post-completion gate that hard-fails: the review baseline gate
(`review.ts:583`) returns `1` on red, so the whole run exits `1` on otherwise
-finished work. The operator fixes the nit by hand and re-runs. The harness
should self-correct within its iteration budget instead.

## Desired behavior

Red `ready` at completion = not complete. The harness does **not** accept
completion — it loops back into the implementation iteration, feeding the
captured `ready` output to the agent as the next task. The captured failure is
the same stdout/stderr text `runReadyAndCommit` surfaces on failure (no
`check:fix` commit on the red path).

- The loop-back consumes one iteration and counts against `maxIterations` (it is
  real fix-up work), so it cannot loop unbounded.
- The fix-up iteration's progress is measured by **`ready` going red→green**,
  not by a new checkbox transition (all boxes are already ticked, so the
  existing no-progress/no-tick stop would otherwise fire spuriously).
- Still red after the iteration with no other change → stop with the captured
  `ready` failure and a worktree pointer (recoverable), a distinct stop reason —
  not the generic no-progress message.

## Decisions

- Red at completion loops back rather than erroring — rules out leaving the
  post-completion baseline-gate hard-fail (`review.ts:583`) as the first
  re-run, which exits `1` on finished work.
- Fix-up progress is `ready` red→green, not a checkbox delta — rules out reusing
  the checkbox-transition no-progress test, which would stop spuriously when all
  boxes are already ticked.
- Stuck-red stop carries the captured `ready` failure + worktree pointer and its
  own stop reason — rules out emitting the generic no-progress stop, which hides
  the actual failure from the operator.
- Once the completion gate guarantees green before the post-completion phases,
  the baseline gate's red→exit-`1` path becomes effectively unreachable for the
  completion case; decide at implementation whether to leave it as a backstop or
  soften it. Deferred to first consumer: leave-vs-soften — pin when implementing.

## Documentation updates

- `v1/docs/run-loop.md`: the red→green loop-back, its iteration accounting, the
  new stop reason, and any baseline-gate softening decided here.
- `v2/docs/v1-behaviors.md`: red-completion loop-back and stop behavior (changed
  completion path).

## Out of scope

- Making the agent run `bun run ready` per iteration.
- Shrink rollback-vs-preserve behavior (tracked separately).
- Auto-ticking or the harness judging acceptance-criteria content.

## Prerequisites
- Harness runs `bun run ready` at the completion transition and proceeds on green.
