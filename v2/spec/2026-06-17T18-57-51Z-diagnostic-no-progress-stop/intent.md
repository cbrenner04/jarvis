---
name: diagnostic-no-progress-stop
---
# No-progress stop names unticked criteria

**Scope.** `v1/src/modes/patch/run.ts` (no-progress stop path), docs.

## Problem

When an agent runs clean but ticks nothing, the run stops with the generic
`iteration N made no progress; stopping`. If the work is in fact done-but-
unticked, the operator has no pointer and must spelunk the spec and diff to
recover.

## Desired behavior

On the no-progress stop where the agent ran clean but ticked no acceptance
criterion, the stop output names the active subspec's unticked criteria and
points the operator at ticking them if the work is done, making the stall
recoverable without investigation. Exit code stays `4`.

## Decisions

- Diagnostic fires only on the clean-run-but-no-tick no-progress path, not other
  stops.

## Documentation updates

- `v1/docs/run-loop.md`: the no-progress stop, the done-but-unticked recovery,
  and the changed stop-message wording.

## Out of scope

- Changing how completion is measured (still checkbox transitions).
- Auto-ticking or harness judging criteria.

## Prerequisites
