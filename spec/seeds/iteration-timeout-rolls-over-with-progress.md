---
name: iteration-timeout-rolls-over-with-progress
risk: medium
effort: medium
---

# An iteration wall-clock timeout with live output and a committed boundary rolls into the next iteration

## Problem

`iteration_timeout` settles the run as `failed` with `resumable: false` even when the agent was still producing output and the iteration committed a real checkpoint at the boundary. On 2026-10-03/04 four implements (telemetry-confinement, cleanup-delegates, the shared-runtime move, retire-run-start twice) hit the 45-minute wall clock mid-subspec with work committed; each cost the full window plus an operator re-run of `jarvis run workflow implement`, which then continued from the checkpoint without incident.

## Decisions

- A wall-clock timeout whose iteration both produced output within the idle-output window and landed a non-empty boundary commit is a progress boundary, not a failure: the loop starts the next iteration on the same subspec, counted against the run's existing iteration cap.
- A timeout with no output or no commit stays terminal: that is the stall the watchdog exists for.
- The settlement records which case applied (`iteration_timeout_continued` vs `iteration_timeout`), and a terminal timeout is `resumable: true` so `jarvis run resume` works without re-admitting the spec.
- Plan must decide the cap interaction (whether a rolled-over iteration consumes one of the run's iterations) and the operator-facing log line.

## Documentation updates

- `docs/spec-guidance.md`: a subspec that rewrites more than a few hundred lines in one file, or whose file list is open-ended, is a timeout waiting to happen and must be split or sized explicitly.
