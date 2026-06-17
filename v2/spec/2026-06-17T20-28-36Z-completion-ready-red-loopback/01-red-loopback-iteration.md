# Loop the red completion gate back into one fix-up iteration

Depends on `00-completion-ready-gate.md` (the gate and its captured red text).

## Problem

The iteration loop short-circuits to the completion path whenever zero boxes are
unchecked: `runIteration` (`v1/src/modes/patch/run.ts:734`) reads
`before = countUnchecked(specPath)` and, at `before === 0`, returns
`tryFinishSpecIfDone(ctx)` (`run.ts:739`) **before building any prompt**. The
only prompt-construction path (`getFirstUncheckedTask` → `buildPrompt`,
`run.ts:761`) reads an unchecked spec task. There is no existing way to feed the
captured `ready` failure to the agent as a task, and at full completion the
in-iteration `## Blocker` check (`run.ts:774`) never runs because it is gated on
`activeSubspecPath !== undefined` and `getActiveLinkedSubspecPath`
(`v1/src/modes/patch/completion.ts:52`) returns `undefined` when every linked
subspec is checked. This subspec adds the fix-up iteration mechanism on top of
00's loop-back signal.

## Behavior

When 00's completion gate yields its red loop-back signal, the harness performs
**one more agent iteration** instead of accepting completion:

- **Task source.** The fix-up iteration's prompt is built from the **captured
  `ready` failure text** (00), not from `getFirstUncheckedTask`. The
  `before === 0` short-circuit (`run.ts:739`) is bypassed for this iteration so
  the prompt path is reached; the prompt presents the `bun run ready failed:`
  output as the work to do. `Deferred to first consumer: the exact prompt
  framing/wording around the captured text — pin when implementing.`
- **Iteration accounting.** The fix-up iteration is a real implementation
  iteration: it increments `state.iteration` and is bounded by `maxIterations`
  (`run.ts:719`). When the budget is already exhausted, the existing
  max-iterations stop fires (exit `5`) instead of looping again. Its telemetry
  record is a normal patch attempt — `kind: "ok"`, `agent !== "harness"`, no
  `patch_phase`, not `record_role: "run_terminal"` — so it counts in
  `patchIterationsCompletedForSummary` (`run.ts:565`) like any other iteration
  and the run summary reports it.
- **Progress test.** Progress for the fix-up iteration is **`ready` going
  red→green**, re-running 00's completion gate after the agent returns — not a
  checkbox delta. All boxes are already ticked, so the checkbox-delta
  no-progress stop (`after === before && !subspecCompleted && !subspecProgressed`
  → exit `4`, `run.ts:1190`) must **not** run for a fix-up iteration; it would
  fire spuriously. Green after the fix-up iteration → proceed into the
  post-completion phases as on 00's green path.
- **Blocker/dirty detection at completion.** Because the in-iteration blocker
  check is unreachable at full completion (see Problem), the fix-up iteration
  must detect a `## Blocker` added during it via a path that does not depend on
  an unchecked linked subspec — re-parse the relevant subspec(s) for a
  `## Blocker` after the agent returns. A blocker added during the fix-up
  iteration stops with exit `7`; a dirty worktree after the fix-up iteration is
  detected by the existing `worktreeCompletionBlocker` (already independent of
  active subspec, `run.ts:1126`/`1338`) and stops with exit `6`. Both take
  precedence over the stuck-red stop (`02`). Quota/model/agent-error/timeout/
  SIGINT classify exactly as on a normal iteration.

Still-red-after-fix-up handling (the stuck-red stop, its exit code, and the
changed-vs-unchanged failure comparison) is specified in `02-stuck-red-stop.md`.

## Decisions

- Fix-up prompt is the captured `ready` failure, fed by bypassing the
  `before === 0` short-circuit — rules out reusing `getFirstUncheckedTask`,
  which has no unchecked task to return at full completion and cannot carry the
  `ready` output.
- Fix-up progress is `ready` red→green (re-run the gate post-iteration), not a
  checkbox delta — rules out reusing the exit-`4` checkbox-delta no-progress
  test, which stops spuriously when all boxes are already ticked.
- Fix-up blocker detection re-parses subspecs for `## Blocker` rather than
  relying on the active-subspec-gated in-iteration check — rules out promising
  exit `7` precedence (AC) behind a path that does not execute at full
  completion.
- The fix-up iteration emits a normal patch-attempt telemetry record so it
  counts toward `maxIterations` and the summary — rules out a phase-tagged or
  `run_terminal` record that the summary would exclude, leaving "counts as an
  iteration" unobservable.

## Tasks

- Turn 00's red loop-back signal into one counted implementation iteration that
  bypasses the `before === 0` short-circuit and builds its prompt from the
  captured `ready` failure text.
- Gate the fix-up iteration by `maxIterations`; an already-exhausted budget
  stops with exit `5`.
- Re-run 00's completion gate after the fix-up iteration; on green proceed into
  the post-completion phases.
- Suppress the exit-`4` checkbox-delta no-progress stop for fix-up iterations.
- Detect a `## Blocker` added during the fix-up iteration without depending on an
  unchecked linked subspec, and stop with exit `7`; keep the existing dirty-
  worktree exit-`6` precedence.
- Emit a normal patch-attempt telemetry record for the fix-up iteration so it
  counts in `patchIterationsCompletedForSummary`.
- Add/adjust tests in `v1/test/modes/patch/` covering: red→green fix-up proceeds
  into shrink/review and can complete `0`; the fix-up iteration does not stop via
  the checkbox-delta no-progress path; an exhausted budget stops with exit `5`;
  a `## Blocker` added during the fix-up iteration stops with exit `7` and a
  dirty worktree stops with exit `6`, both ahead of the stuck-red stop; the
  fix-up iteration appears in the run summary's implementation-iteration count.
- Update docs (below).

## Acceptance criteria

- [ ] A red completion gate performs one more agent iteration whose task is the
      captured `ready` failure text rather than accepting completion.
- [ ] The fix-up iteration counts against `maxIterations`; an unbounded
      red-`ready` loop cannot occur, and an already-exhausted budget stops with
      the existing max-iterations behavior (exit `5`).
- [ ] After a fix-up iteration the run re-runs `ready`: green proceeds into the
      post-completion phases (shrink → review → ready transition) and the run can
      complete `0`.
- [ ] The fix-up iteration does not stop via the checkbox-delta no-progress path
      (exit `4`) even though no new checkbox is ticked.
- [ ] A `## Blocker` added during a fix-up iteration stops with exit `7`, and a
      dirty-worktree blocker stops with exit `6`, both taking precedence over the
      stuck-red stop defined in `02-stuck-red-stop.md`.
- [ ] The fix-up iteration is counted as an implementation iteration in the run
      summary (it is not tagged as a shrink/review phase or run-terminal record).

## Documentation updates

- [ ] `v1/docs/run-loop.md`: document the red→green loop-back, that the fix-up
      iteration's task is the captured `ready` failure, its `maxIterations`
      accounting, the red→green progress test replacing the checkbox-delta test
      for fix-up iterations, and the blocker(`7`)/dirty(`6`) precedence during a
      fix-up iteration.
- [ ] `v2/docs/v1-behaviors.md`: record the red-`ready` loop-back and fix-up
      progress test under the patch-mode catalog, with `Sources:` pointers
      (`run.ts:734`/`739`/`761`/`774`/`1190`, `completion.ts:52`).
