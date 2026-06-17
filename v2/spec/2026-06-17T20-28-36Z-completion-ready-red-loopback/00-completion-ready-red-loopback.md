# Loop back into iteration on red completion `ready`

## Problem

At the completion transition (zero unchecked boxes, clean tree, `git: true`,
implementation iterations ran), the harness runs `bun run ready` inside the
post-completion phases. The first such gate is the review baseline gate
(`v1/src/modes/patch/review.ts:583`), which returns `1` on red — the whole run
exits `1` on otherwise-finished work. The operator hand-fixes the nit and
re-runs. Within its iteration budget the harness should self-correct instead.

## Behavior

Run `bun run ready` as a **completion gate** in `tryFinishSpecIfDone`
(`v1/src/modes/patch/run.ts`) **before** entering the post-completion phases
(shrink/review). This gate only applies on the same path the existing
post-completion `ready` runs today: `git: true`, clean tree, at least one
implementation iteration. On green: proceed unchanged (commit any `check:fix`
output as today, then shrink → review → `maybeMarkReady`).

On **red** the harness does not accept completion. It loops back into one more
implementation iteration:

- The next iteration's task is the **captured `ready` failure** — the same
  stdout/stderr text `runReadyAndCommit` surfaces on red (`bun run ready
  failed:\n<captured>`). No `check:fix` commit happens on the red path.
- The loop-back **consumes one iteration** and counts against `maxIterations`,
  so it cannot loop unbounded. When the budget is already exhausted, the
  existing max-iterations stop (exit `5`) fires instead of looping again.
- Progress for a fix-up iteration is measured by **`ready` going red→green**,
  re-running the completion gate after the agent returns — not by a new
  checkbox transition. All boxes are already ticked, so the checkbox-delta
  no-progress test must not run for this iteration and must not stop the run
  spuriously.
- Green after the fix-up iteration → proceed into the post-completion phases as
  on the green path.
- Still red after a fix-up iteration **and** the agent ticked no box, added no
  blocker, and the captured `ready` failure is unchanged → stop with a
  **distinct, recoverable stop reason** (a new exit code, not `4`/no-progress
  and not `1`). The stop carries the captured `ready` failure and a worktree
  pointer (path + `jarvis1 triage <worktree-name>`), so the operator can fix it
  by hand. Existing stronger stops still take precedence on this path: a
  `## Blocker` added during the fix-up iteration stops with exit `7`; a dirty
  worktree blocker stops with exit `6`; quota/model/agent-error/timeout/SIGINT
  classify as on a normal iteration.

A red `ready` failure body that **changes** between fix-up iterations counts as
progress (the agent moved the failure), so the run keeps looping until green or
`maxIterations`.

### Baseline-gate disposition

Once the completion gate guarantees `ready` is green before the post-completion
phases, the review baseline gate's red→exit-`1` path
(`v1/src/modes/patch/review.ts:583`) is effectively unreachable for the
completion case. `Deferred to first consumer: leave the baseline gate as a
backstop vs. soften it — pin when implementing.` Whichever is chosen, do not
introduce a second operator-visible completion behavior where red `ready`
exits `1` on finished work; the loop-back is the single completion-path
response to red `ready`.

## Decisions

- Completion gate runs `bun run ready` before shrink/review, not only inside the
  review baseline gate — rules out leaving the only completion `ready` inside
  review, where `passes: 0` would skip the gate and let red `ready` reach
  `maybeMarkReady` ungated.
- Red at completion loops back rather than erroring — rules out leaving the
  baseline-gate hard-fail (`review.ts:583`) as the first re-run, which exits
  `1` on finished work.
- Fix-up progress is `ready` red→green (re-run the gate post-iteration), not a
  checkbox delta — rules out reusing the checkbox-transition no-progress test,
  which stops spuriously when all boxes are already ticked.
- A changed `ready` failure body counts as progress — rules out stopping the
  first time `ready` is still red when the agent demonstrably advanced the
  failure.
- Stuck-red stop is a new exit code carrying the captured failure + worktree
  pointer — rules out reusing exit `4` (generic no-progress) or `1`, which hide
  the actual `ready` failure from the operator.

## Tasks

- Add a completion `ready` gate in `tryFinishSpecIfDone` that runs on the
  `git: true` / clean-tree / iterations-ran path, before shrink/review, and
  returns a loop-back signal (not an exit code) on red while capturing the
  failure text.
- Turn the loop-back signal into one counted implementation iteration whose
  task is the captured `ready` failure, gated by `maxIterations`.
- Re-run the completion gate after the fix-up iteration; on green proceed, on
  unchanged red with no box/blocker/dirty change stop with the new exit code +
  message; on changed red keep looping.
- Suppress the checkbox-delta no-progress stop for fix-up iterations.
- Pin the baseline-gate leave-vs-soften decision and adjust
  `v1/src/modes/patch/review.ts` accordingly.
- Add/adjust tests in `v1/test/modes/patch/` covering: green completion gate
  proceeds unchanged; red→green fix-up proceeds; red→red unchanged stops with
  the new reason (not `4`, not `1`) and surfaces the captured failure +
  worktree pointer; loop-back respects `maxIterations`; blocker/dirty during
  fix-up still win.
- Update docs (below).

## Acceptance criteria

- [ ] A red `bun run ready` at the completion transition (`git: true`, clean
      tree, implementation iterations ran) does not exit the run with `1`;
      instead the run performs one more agent iteration whose task is the
      captured `ready` failure text.
- [ ] The loop-back iteration counts against `maxIterations`; an unbounded
      red-`ready` loop cannot occur, and an already-exhausted budget stops with
      the existing max-iterations behavior (exit `5`).
- [ ] After a fix-up iteration, the run re-runs `ready`: green proceeds into the
      post-completion phases (shrink → review → ready transition) and the run
      can complete `0`; the fix-up iteration does not stop via the
      checkbox-delta no-progress path even though no new checkbox was ticked.
- [ ] When `ready` is still red after a fix-up iteration with no new checkbox,
      no new `## Blocker`, and an unchanged captured `ready` failure, the run
      stops with a recoverable stop reason distinct from no-progress (exit code
      not `4`) and from the hard error (exit code not `1`), and the stderr names
      the captured `ready` failure plus the worktree path and
      `jarvis1 triage <worktree-name>`.
- [ ] A captured `ready` failure body that changes between fix-up iterations is
      treated as progress: the run loops again rather than stopping.
- [ ] A `## Blocker` added during a fix-up iteration stops with exit `7`, and a
      dirty-worktree blocker stops with exit `6`, taking precedence over the
      stuck-red stop.
- [ ] On the green completion path (no red `ready`), behavior is unchanged: the
      run proceeds shrink → review → `maybeMarkReady` and prints `spec complete`
      with the PR URL as before.
- [ ] The review baseline-gate red→exit-`1` path is reconciled with the
      completion gate (left as an unreachable backstop or softened, per the
      pinned decision) so no completion-path run exits `1` solely because
      `ready` was red.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: document the completion `ready` gate, the red→green
      loop-back, its `maxIterations` accounting, the red→green progress test
      (replacing the checkbox-delta test for fix-up iterations), the new
      stuck-red stop reason, and its new exit-code row in the stop-conditions
      table; note the baseline-gate disposition.
- [ ] `v2/docs/v1-behaviors.md`: record the changed completion path — completion
      `ready` gate, red-`ready` loop-back, fix-up progress test, and stuck-red
      stop — under the patch-mode catalog, with `Sources:` pointers.
