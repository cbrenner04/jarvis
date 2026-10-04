---
name: extract-daemon-revise-reconverge
---

# Extract daemon.ts revise/reconverge region

`daemon.ts` is 1256 lines. `buildRevisionWriteLoopInput`, `reviseAwaitingHuman`, and `reconvergeRevisingRun` form a self-contained revise/reconverge region extractable into its own module.

## Decisions

- Move the region into a new file under `v2/src/daemon/`; `daemon.ts` imports it.
- No behavior change; existing daemon tests stay green.
- Update `v2/docs/v2-architecture.md` domain map for the move.

## Out of scope

- Any behavior change.
- The list-snapshot assembly region (separate intent).

## Prerequisites

- daemon.ts contains a self-contained revise/reconverge region (`buildRevisionWriteLoopInput`, `reviseAwaitingHuman`, `reconvergeRevisingRun`) with no external callers outside daemon.ts
