# 01 - Gate-only continuation

## Problem

Snapshot-backed reconstruction can resolve a review row's persisted gate commands, but gate-only continuation (`maxIterations: 0`, retained finalization checkpoint / exhausted-red lineage) must still invoke the snapshot `readyCommand` through `readyFinalizer` after store reload even when live machine config would supply a different command or none.

## Decision ledger

- Gate-only continuation for a review or review-debate row uses snapshot-backed `readyCommand`/`fixCommand` from that row's own workflow-snapshot step first; rules out silently switching to current config or the built-in default after dispatch.
- When the review row's snapshot step omits both fields (legacy snapshot), fall back to the durable write sibling's stamped `queuedInput` or snapshot step; rules out breaking intent-finalization and review-mutation resume paths that today depend on write-sibling stamping.
- Fresh-dispatch command selection stays owned by [[00-fresh-dispatch-gate-commands]]; this subspec only wires continuation invocation.

## Task checklist

- Audit gate-only continuation entry points (exhausted-red gate-only resume and review-row finalization resume with `maxIterations: 0`) and ensure each passes snapshot-resolved gate commands into the inert `WriteLoopInput` fed to `publishWithReadyRepair`.
- Add a regression that seeds a review row with a retained finalization checkpoint and snapshot-stamped `readyCommand`, simulates a live config change that would alter the command, reloads the store, resumes gate-only finalization, and asserts the finalizer receives the persisted snapshot value.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-resume.test.ts` proves a persisted review-row `readyCommand` is invoked after store reload even when live config differs; the test fails against the pre-fix path that resolves gate commands from live config or the built-in default instead of the review snapshot step reachable on main.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to [[04-documentation]].
