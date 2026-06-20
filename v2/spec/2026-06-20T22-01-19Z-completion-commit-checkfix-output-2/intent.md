---
name: completion-commit-checkfix-output
---
# Bound the completion fix-up loop on a non-converging *changing* failure

**Scope.** The patch completion fix-up loop's stop condition only. Add a bound for a completion that stays red across iterations while the failure *changes*, which the existing identical-failure stop misses.

## Already shipped — do NOT rebuild

The obvious completion-checkfix fixes already exist on `main` (verified by the plan that blocked the first draft of this intent, #254/#285/#313):

- **Green-but-reformatted converges in one pass.** `runReadyAndCommit` full tier runs `bun run ready` then commits a dirty tree via `realCommitCheckFix` (`v1/src/ready-gate.ts` ~`:86-128`); the completion gate calls it at full tier (`v1/src/modes/patch/completion-pipeline.ts` ~`:158-162`). Pure check:fix formatting is committed, not looped.
- **Green-dirty vs red distinction** exists (`scripts/ready.ts` check:fix-then-check).
- **Identical-failure stop:** when the *normalized* ready failure text repeats with no new AC and no new blocker, the loop exits `10` `ready-stuck-red` (`completion-pipeline.ts` ~`:205-232`, `isReadyFailureUnchanged` + `normalizeReadyFailureText`).

This intent does not touch any of the above. It does not change `ready`/`check:fix`.

## Problem (the residual gap)

The `ready-stuck-red` fast-stop requires `isReadyFailureUnchanged` — the normalized failure text must be **identical** to the prior iteration. A completion that stays red while the failure **changes** each iteration never trips it, so it rides `maxIterations` (exit `5`) — a long, costly spin. Two real triggers seen this session:

- Churning unfixable lint: `check:fix` (safe) can't fix some lint (e.g. needs `--unsafe`), `check` stays red, the agent's edits produce a *different* red each pass (different file/line) → text changes → no stop → rides the loop.
- A flaky completion failure (a different flaky test each run) → failure text changes → no stop → rides the loop.

Evidence: `shared-pr-module` (#291) spun ~47 min, `shared-spec-blocker-parsing` (#294) caught at iteration 4, `review-shrink-model-tiering` (#310) timed out — all non-converging completions that the identical-failure stop did not catch.

## Desired behavior

A completion that produces a red ready gate on N consecutive fix-up iterations with **no new acceptance criterion checked** stops with a clear terminal status — even when the failure text differs each time. Convergence (a passing gate, or genuine AC progress) resets the count. The existing identical-failure exit-10 stop and green-dirty commit are unchanged; this only adds a bound for the changing-failure case so it can't ride `maxIterations`.

## Decisions

- Add a bounded count of consecutive red completion fix-up iterations with no new AC checked; on reaching it, stop with a terminal reason (reuse `ready-stuck-red` exit `10`, or a sibling reason — pin at implementation). Rules out relying solely on identical-text matching to bound non-convergence.
- The count resets on a green gate or a newly-checked AC (real progress). Rules out stopping a completion that is still making progress.
- Keep `isReadyFailureUnchanged`/exit-10 and `realCommitCheckFix` exactly as they are; this is additive. Rules out reworking the shipped green-dirty / identical-stuck paths.
- Pick N small enough to cut the 47-min spins but above 1 (allow one genuine fix-up). Pin the exact N at implementation against the existing fix-up semantics. Rules out an N so large it reproduces the maxIterations spin.

## Acceptance signals

- A completion whose ready gate stays red with a *different* failure text each iteration and no new AC checked stops at the bound with the terminal reason, not at `maxIterations` (test).
- A completion that goes red once then green still completes (the bound allows genuine fix-up) (test).
- The existing identical-failure exit-10 stop and the green-dirty single-pass commit are unchanged (existing tests stay green).
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: completion fix-up loop now bounds a changing non-converging failure, not only identical ones.
- `v2/docs/v1-behaviors.md`: record the changing-failure completion bound.
- `v2/spec/wip-intents/completion-commit-checkfix-output.md`: remove once landed.

## Out of scope

- The green-dirty commit and identical-failure stop (already shipped, above).
- The no-progress stop misfiring on complete-but-unticked first runs ([[no-progress-stop-spares-green-work]]) — separate intent; that one is about *first* runs that tick nothing, this is about *fix-up* iterations that stay red.
- Stabilizing the flaky tests themselves ([[flaky-process-timing-tests-block-runs]]) — this bounds the loop they trigger, it does not de-flake them.

## Prerequisites

- The non-converging completion spin is reproducible (this session: #291/#294/#310) and distinct from the already-shipped identical-failure stop.
- `bun run typecheck` and `bun run test` green on `main`.
