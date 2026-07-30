---
name: pipeline-daemon-observation-and-wait
---

# Observe and wait for daemon-owned pipelines

## Prerequisites

- Validated pipeline admission durably creates ordered stage records.
- Daemon-owned ordered execution updates pipeline stage lifecycle.
- The state store enumerates admitted pipelines with complete ordered stage records.

## Problem

Daemon-owned pipelines have no request surface for current state or approval/terminal synchronization.

## Decisions

- Add daemon pipeline snapshots containing pipeline identity, derived state, and ordered stage ID/status/workflow invocation ID; rules out reconstructing pipeline progress from run rows.
- Pipeline snapshot requests return current durable state promptly even while execution is live; rules out an implicit follow loop.
- Add an explicit wait that returns only at pipeline terminal or the next awaiting-approval boundary and identifies which boundary occurred; rules out an unnamed intermediate return.
- Unknown pipeline IDs return a named refusal; rules out an empty result indistinguishable from a transport failure.

## Acceptance criteria

- [ ] A snapshot over multiple pipelines reports each pipeline row and its ordered stage rows with stage ID, status, and workflow invocation ID.
- [ ] A live non-terminal pipeline snapshot completes under a bounded regression harness rather than following execution.
- [ ] Pipeline wait returns a named terminal result for a terminal pipeline and a named awaiting-approval result at an approval boundary.
- [ ] Daemon regressions fail before these request behaviors and pass after them; inverting the live-snapshot non-follow guard fails its regression.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline snapshot and wait request contracts, derived state, errors, and blocking boundaries.
