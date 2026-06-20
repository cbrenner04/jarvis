# Bound changing-failure completion fix-up

## Problem

The completion fix-up loop's only fast stop is `isReadyFailureUnchanged` → exit `10` `ready-stuck-red` (`v1/src/modes/patch/completion-pipeline.ts` ~`:205-237`): it requires the *normalized* ready-failure text to be **identical** to the prior iteration. A completion that stays red while the failure text **changes** each iteration (churning unsafe-lint, a different flaky test each run) never trips it — the red branch just sets `completionLoopbackSignal` and loops, riding `maxIterations` (exit `5`). Observed: `shared-pr-module` (#291) ~47 min spin; `review-shrink-model-tiering` (#310) timeout.

Add a bound on consecutive red completion fix-up iterations that make no acceptance-criteria progress, so the changing-failure case stops with a terminal status instead of riding the loop.

## Decisions

- Add a counter on patch iteration state of consecutive red completion gates with no newly-checked AC since the prior gate; on reaching N, stop with a terminal reason. Rules out leaving non-convergence bounded only by identical-text matching.
- Reset the counter to 0 on a green gate or a newly-checked acceptance criterion. Rules out stopping a completion still making genuine progress.
- Reuse exit `10` / reason `ready-stuck-red` for the new stop (not a new sibling reason/exit code). Rules out adding an operator-visible exit code for what is the same recoverable "stuck red, intervene" outcome; pin during implementation if the existing stuck-red message cannot also cover the changing-failure case clearly.
- Keep `isReadyFailureUnchanged`, the existing exit-10 path, and `realCommitCheckFix` (green-dirty single-pass commit) exactly as they are; this is purely additive. Rules out reworking the shipped identical-stuck / green-dirty paths.
- Pin N small (cuts the 47-min spins) but `> 1` (allow one genuine fix-up). Rules out an N large enough to reproduce the `maxIterations` spin. Pin the exact value at implementation against the existing fix-up semantics.

## Task checklist

- Add the consecutive-red-fix-up counter to the patch iteration state (`v1/src/modes/patch/run.ts` `IterationContext["state"]`, initialized in `runCommand`).
- In the red branch of `tryFinishSpecIfDone`/`runCompletionReadyGate` (`completion-pipeline.ts`), after the existing `isStuckRed` check fails, increment the counter and stop with `ready-stuck-red` exit `10` when it reaches N; otherwise continue the existing loop-back.
- Reset the counter on a green gate and on a newly-checked AC (genuine progress).
- Tests: changing-failure red across N gates with no new AC stops at the bound; red-once-then-green completes; existing identical-failure and green-dirty tests stay green.
- Docs: `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A completion whose ready gate returns red with a *different* failure text each iteration and no newly-checked AC stops at the bound with reason `ready-stuck-red` (exit `10`), not at `maxIterations` (exit `5`) (test, using the `runCompletionReadyGate` seam).
- [ ] A completion whose ready gate is red once then green completes normally (exit `0`); the bound does not fire on a single red fix-up (test).
- [ ] The counter resets on genuine progress: a green gate or a newly-checked acceptance criterion sets the consecutive-red count back to 0 so a later red restarts the bound from one (test).
- [ ] The existing identical-failure exit-`10` stop and the green-dirty single-pass `check:fix` commit are unchanged (their existing tests stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md` (§ "Stuck-red completion stop (exit 10)" ~`:382-401` and the exit-code table row for `10` ~`:722`): the loop also stops when the gate stays red for N consecutive fix-up iterations with no AC progress even if the failure text differs each time.
- `v2/docs/v1-behaviors.md` (§ "Patch-mode stuck-red completion stop (exit 10)" ~`:56-60`): record the changing-failure completion bound and its reset-on-progress semantics alongside the identical-failure stop.
- `v2/spec/wip-intents/completion-commit-checkfix-output.md`: remove once landed.
