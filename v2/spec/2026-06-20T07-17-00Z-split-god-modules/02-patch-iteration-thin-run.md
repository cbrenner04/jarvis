# Extract patch iteration, thin run.ts

## Problem

After preflight (00) and the completion pipeline (01) are extracted, the remaining bulk of `v1/src/modes/patch/run.ts` is the iteration loop (`runIteration` ~800 LOC) and its watchdog/logging helpers. Extracting it leaves `run.ts` a thin entry that wires preflight → iteration → completion.

## Decisions

- Move the iteration seam to a new `v1/src/modes/patch/iteration.ts`; co-locate its private helpers. Rules out keeping the largest seam in the entry module.
- Anchor functions to relocate: `runIteration`, plus supporting helpers (`finalize`, `setupLogging`, `getSpecDisplayName` (display helper for `setupLogging`/`finalize`), the watchdog helpers `formatWatchdogDiagnosticsSuffix`/`snapshotWatchdogDescendantsAlive`/`killWatchdogWithDescendants`, `printBoundedTail`, `splitLines`, `confirmFromStdin`). `iteration.ts` imports `preflight.ts` and `completion-pipeline.ts` as needed. Rules out splitting helpers from their callers.
- `run.ts` retains `runCommand` (the public entry) plus its type surface (`RunCommandOptions`, `RunIo`, `ConfirmRun`) and re-exports any symbols relocated in 00–02 that `cli.ts` or `v1/test/run.test.ts` import, so external import paths stay on `patch/run.ts`. Rules out moving the public entry and forcing consumer churn.
- Refactor-only: relocation + import wiring, no logic edits.

## Task checklist

- [ ] Create `iteration.ts` with the iteration seam and its private helpers.
- [ ] Reduce `run.ts` to the `runCommand` entry + types + re-exports.
- [ ] Update the `opencodeUnavailableNoted` source pointer in `v1/docs/run-loop.md` to the relocated module path.
- [ ] `bun run typecheck`; `bun run test`.

## Acceptance criteria

- [x] `v1/src/modes/patch/iteration.ts` exists and defines `runIteration`.
- [x] `v1/src/modes/patch/run.ts` no longer defines `runIteration` and is substantially thinner (entry + types + re-exports only).
- [x] `cli.ts` and `v1/test/run.test.ts` import `runCommand`/`RunCommandOptions`/`RunIo` from `v1/src/modes/patch/run.ts` unchanged; no test behavioral assertions change.
- [x] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/run-loop.md`: repoint the `opencodeUnavailableNoted` source reference (line ~651) to `iteration.ts` if that gate relocates. No other doc change; behavior unchanged, so `v2/docs/v1-behaviors.md` is unchanged.

## Blocker

Test suite shows one consistent failure in `runCommand > timeout behavior > watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry`. Expected: `watchdog_descendants_alive=true`; Received: `watchdog_descendants_alive=false`.

Investigation: The refactoring is complete (code moved, no logic changes). `iteration.ts` exists with `runIteration`, `run.ts` is thin entry + types + re-exports, imports in `cli.ts` and tests unchanged, `typecheck` passes. The failing test is a known flaky process-timing test (documented in f484431 intent seed). The watchdog/descendant tracking functions (`snapshotWatchdogDescendantsAlive`, `collectSubtree`, `listProcesses`) are unchanged from the original code, just relocated to a new module. The test failure could be:
- Pre-existing flakiness (process polling timing under load)
- Subtle issue with module boundary relocation (e.g., module initialization, closure scope)

Cannot determine root cause without deeper process-level diagnostics outside scope of pure refactoring.
