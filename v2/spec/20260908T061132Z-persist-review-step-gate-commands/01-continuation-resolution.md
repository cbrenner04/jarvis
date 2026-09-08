# 01 - Continuation resolution

## Problem

`resolveWriteSiblingCommandSource` (`v2/src/execution/workflow-runner-resume.ts`) resolves `fixCommand` and `readyCommand` for review and review-debate rows only from the durable write sibling's `queuedInput` or snapshot step. After subspec 00 persists gate commands on the review row itself, continuation still ignores them and cannot survive a live machine-config edit that changes or clears the project's overrides.

## Decision ledger

- Gate-only continuation for a review or review-debate row reads `fixCommand` and `readyCommand` from that row's own workflow-snapshot step first; rules out re-reading mutable machine config during reconstruction.
- When the review row's snapshot step omits both fields (legacy snapshot), fall back to the durable write sibling's stamped `queuedInput` or snapshot step; rules out breaking intent-finalization and review-mutation resume paths that today depend on write-sibling stamping.
- Reconstruction exposes dispatch-time values to downstream resume tails only; rules out changing which command the ready gate spawns on fresh dispatch (owned by [[run-review-finalization-with-resolved-gate-commands]]).

## Task checklist

- Update `resolveWriteSiblingCommandSource` (and any shared helper it feeds) to prefer the review row's own snapshot-step gate commands when present.
- Retain write-sibling fallback when the review row's snapshot step omits both fields.
- Add a regression that seeds a failed review or review-debate row whose snapshot carries stamped gate commands, simulates a live config change that would alter those commands, and asserts reconstruction still yields the persisted snapshot values.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-resume.test.ts` proves gate-command reconstruction for a review or review-debate row returns the persisted snapshot-step `fixCommand` and `readyCommand` after a simulated live config change; the test fails against the pre-fix write-sibling-only `resolveWriteSiblingCommandSource` path reachable on main.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` test `intent-finalization resume uses write-sibling stamped fix and ready commands` stays green, proving the write-sibling fallback is preserved for legacy snapshots.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates
