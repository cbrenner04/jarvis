# Bound changing-failure completion fix-up

## Problem

The completion fix-up loop's only fast stop is `isReadyFailureUnchanged` → exit `10` `ready-stuck-red` (`v1/src/modes/patch/completion-pipeline.ts` ~`:202-237`): it requires the *normalized* ready-failure text to be **identical** to the prior iteration. A completion that stays red while the failure text **changes** each iteration (churning unsafe-lint, a different flaky test each run) never trips it — the red branch just sets `completionLoopbackSignal` and loops, riding `maxIterations` (exit `5`). Observed: `shared-pr-module` (#291) ~47 min spin; `review-shrink-model-tiering` (#310) timeout.

Add a bound on consecutive red completion fix-up iterations that make no acceptance-criteria progress, so the changing-failure case stops with a terminal status instead of riding the loop.

## AC-progress seam

The completion ready gate (`tryFinishSpecIfDone`/`runCompletionReadyGate`) only runs when `countUnchecked === 0`, so at the gate every AC is already checked — nothing is "newly checked" there. The gate cannot observe AC progress directly. The only path that re-ticks a box between two red gates is regression-then-recovery on the **regular implementation path** (`v1/src/modes/patch/iteration.ts` ~`:693`, which already computes `newlyChecked` via `diffAcceptanceCriteria`). So AC progress must be carried to the gate through iteration state: when the regular path commits with `newlyChecked.length > 0`, set an `acProgressSinceLastGate` flag on `IterationContext["state"]`; the gate consumes it (resets the red counter, then clears the flag).

## Decisions

- Add `consecutiveRedFixups` to `IterationContext["state"]`: count of consecutive red completion gates with no AC progress since the prior gate; on reaching N, stop. Rules out leaving non-convergence bounded only by identical-text matching.
- Detect AC progress on the regular implementation path (not at the gate) via an `acProgressSinceLastGate` state flag set when a regular iteration checks a new AC; the gate resets `consecutiveRedFixups` to 0 when the flag is set, then clears the flag. Rules out implying the gate can see AC progress directly (it cannot — every box is already checked there).
- Reset `consecutiveRedFixups` to 0 on a green gate, and on AC progress via the flag above. Rules out stopping a completion still making genuine progress.
- Reuse exit `10` / reason `ready-stuck-red` for the new stop (not a new sibling reason/exit code) — both are the same recoverable "stuck red, intervene" outcome. Rules out adding an operator-visible exit code for a non-distinct outcome. (Conscious omission: a telemetry sub-field distinguishing the two triggers is left out; the branched message below already disambiguates for triage.)
- Emit a **distinct** terminal message for the changing-failure bound, separate from the identical-failure message. The identical-failure message says the failure is *unchanged*; for the changing-failure bound that is false, so reusing it would misdirect triage. The changing-failure message states the gate stayed red for N fix-up iterations with no AC progress while the failure differed each pass. Rules out a wrong "unchanged" line on the changing-failure path.
- Pick N with `1 < N < maxIterations`: `> 1` allows one genuine fix-up; `< maxIterations` guarantees the bound (not the loop ceiling) is what stops the changing-failure spin. Pin the exact value at implementation; default candidate N = 3. Rules out an N large enough to reproduce the `maxIterations` spin and an N=1 that kills a single legitimate fix-up.
- Keep `isReadyFailureUnchanged`, the existing exit-10 identical-failure path, and `realCommitCheckFix` (green-dirty single-pass commit) exactly as they are; this is purely additive. Rules out reworking the shipped identical-stuck / green-dirty paths.

Tradeoff (intended): a completion converging one real failure per pass while already complete cannot be distinguished from thrashing, so the bound can stop it. Accepted — exit 10 is recoverable; the operator reruns to resume.

## Count trace (the contract)

Each red gate with no AC progress increments `consecutiveRedFixups`; a fix-up iteration runs between gates. With N = 3:

```
gate1 red → count=1 (<3) → fix-up
gate2 red → count=2 (<3) → fix-up
gate3 red → count=3 (=N) → stop, exit 10
```

One fix-up runs between gate1→gate2 and gate2→gate3, so N=3 allows two genuine fix-up attempts before the bound; N=2 would allow exactly one. A green gate or AC progress at any point resets `count` to 0.

## Task checklist

- Add `consecutiveRedFixups: number` and `acProgressSinceLastGate: boolean` to `IterationContext["state"]` (`v1/src/modes/patch/run.ts` ~`:93-106`), initialized in `runCommand` (~`:228`).
- On the regular implementation path (`iteration.ts`), set `acProgressSinceLastGate = true` when the committed iteration has `newlyChecked.length > 0`.
- In the red branch of `runCompletionReadyGate`/`tryFinishSpecIfDone` (`completion-pipeline.ts` ~`:202-237`), after the existing `isStuckRed` check fails: if `acProgressSinceLastGate` is set, reset `consecutiveRedFixups = 0` and clear the flag; otherwise increment `consecutiveRedFixups`. When `consecutiveRedFixups >= N`, emit the distinct changing-failure message, write `ready-stuck-red` telemetry, clear `completionLoopbackSignal`, and return `10`. Otherwise continue the existing loop-back.
- Reset `consecutiveRedFixups = 0` on a green gate (alongside the existing `previousCompletionFailureText = null` clear).
- Tests: changing-failure red across N gates with no AC progress stops at the bound; red-once-then-green completes; AC-progress reset; existing identical-failure and green-dirty tests stay green.
- Docs: `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A completion whose ready gate returns red with a *different* failure text each iteration and no AC progress stops at the bound (`consecutiveRedFixups` reaches N) with reason `ready-stuck-red` (exit `10`), not at `maxIterations` (exit `5`); the test fixes N `< maxIterations` so the bound, not the loop ceiling, is what stops it (test, using the `runCompletionReadyGate` seam).
- [x] The terminal message emitted on the changing-failure bound is distinct from the identical-failure message: it does not assert the failure is "unchanged" and states the gate stayed red for N fix-up iterations with no AC progress (test asserting the emitted message text matches the trigger).
- [x] A completion whose ready gate is red once then green completes normally (exit `0`); the bound does not fire on a single red fix-up (test).
- [x] Green-gate reset: red, red, green, then red restarts the count from one rather than tripping the bound (test via the `runCompletionReadyGate` seam).
- [x] AC-progress reset: a fix-up that re-ticks a regressed acceptance criterion on the regular implementation path sets `acProgressSinceLastGate`, and the next red gate resets `consecutiveRedFixups` to 0 (test driving the spec from one-unchecked back to complete mid-loop and asserting the count restarts).
- [x] The existing identical-failure exit-`10` stop and the green-dirty single-pass `check:fix` commit are unchanged (their existing tests stay green).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md` (§ "Stuck-red completion stop (exit 10)" ~`:382-401` and the exit-code table row for `10` ~`:722`): the loop also stops with `ready-stuck-red` when the gate stays red for N consecutive fix-up iterations with no AC progress even if the failure text differs each time; note the distinct changing-failure message and the reset-on-progress semantics.
- `v2/docs/v1-behaviors.md` (§ "Patch-mode stuck-red completion stop (exit 10)" ~`:56-61`): record the changing-failure completion bound, its distinct message, and reset-on-progress semantics alongside the identical-failure stop; **correct the stale source pointer** in that section that attributes the stuck-red logic to `run.ts` (it lives in `v1/src/modes/patch/completion-pipeline.ts`).
- `v2/spec/wip-intents/completion-commit-checkfix-output.md`: remove once landed.

