---
name: landing-failed-names-its-cause
---

# A Non-Repromptable `landing_failed` Names Its Violation And Offending Paths

## Prerequisites

- Intent landing validation produces a violation message naming the offending paths and already surfaces it on the repromptable path as a `landing_contract_reprompt` log record.
- `composeRunOperatorError` maps a terminal `landing_failed` onto the operator error that pipeline stages persist as `failureDetail`.
- Same-seam sibling: shares `v2/src/execution/write-loop.ts` with `intent-landing-never-treats-node-modules-symlink-as-rogue` — plan/run this intent after that one lands, not in parallel off the same base.

## Surface

Execution loop settle plus daemon operator-error composition (`v2/src/execution/write-loop.ts`, `v2/src/persistence/log-stream.ts`, `v2/src/daemon/run-operator-error.ts`).

## Problem

- When the landing-contract gate fails non-repromptably, the violation text the gate already computed is discarded: the stage records `failureDetail: { reason: "landing_failed", retryable: true, nextAction: "resume" }` and `jarvis run log` shows only `iteration_commit` / `boundary_committed` / `loop_finished`.
- Diagnosing the reported failure (pipeline `0ebe64c7`) required a hand `git show --stat HEAD` on the intent branch to discover the offending path.
- This is generic to every rogue-path and landing-contract settle, not only the `node_modules` case.

## Behavior

- A non-repromptable `landing_failed` settle carries a human-readable cause naming the violation class and the offending path(s) (e.g. `rogue path outside .jarvis-intent-stage/: node_modules`) on the stage `failureDetail` and in the run log, so `run list` / `run wait` / `run log` explain the failure without inspecting git.
- The repromptable path's existing reprompt record is unchanged.

## Decisions

- Carry the cause as free-text `message` alongside the existing closed `reason` / `nextAction` fields — rules out extending the closed operator-error reason taxonomy per violation class.
- Emit the cause on the terminal log record at settle and compose `failureDetail` from it — rules out reconstructing the cause later from git or worktree state, which is gone by then.
- Truncate the offending-path list the same way other log text is bounded — rules out an unbounded path dump on a large violation.

## Required verification

- A test drives a landing-contract violation to a non-repromptable settle and asserts the composed operator error carries a `message` naming the violation class and the offending path, and that the run log contains the matching record; it fails against the pre-fix cause-less settle.

## Documentation updates

- `v2/docs/workflow-runner.md` — terminal `landing_failed` names its violation class and offending paths.
- `v2/docs/daemon-host.md` — the operator-error record's cause field on `landing_failed`.
- `v2/docs/v1-behaviors.md` — record the changed failure-reporting behavior against the parity baseline.
