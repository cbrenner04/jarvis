---
name: extract-daemon-list-snapshot
---

# Extract daemon.ts list-snapshot assembly region

`daemon.ts` is 1256 lines. `workflowRowSnapshot` and `workflowStepSnapshot` form a self-contained list-snapshot assembly region extractable into its own module.

## Decisions

- Move the region into a new file under `v2/src/daemon/`; `daemon.ts` imports it.
- No behavior change; existing daemon tests stay green.
- Update `v2/docs/v2-architecture.md` domain map for the move.

## Out of scope

- Any behavior change.
- The revise/reconverge region (separate intent).

## Prerequisites

- daemon.ts contains a self-contained list-snapshot assembly region (`workflowRowSnapshot`, `workflowStepSnapshot`) with no external callers outside daemon.ts
