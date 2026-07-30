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
- Derive `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, and `interrupted` from durable pipeline/stage state. `succeeded`, `failed`, `rejected`, and `interrupted` are terminal; rules out treating an undispatched approval or a recovered interruption as live work.
- Pipeline snapshot requests return current durable state promptly even while execution is live; rules out an implicit follow loop.
- Add an explicit wait that returns at a terminal state or when the first unsucceeded authored stage is an undecided approval after all prior stages succeeded. The response names `terminal` with its state or `awaiting-approval` with that stage ID; rules out an unnamed intermediate return.
- Unknown pipeline IDs return a named refusal; rules out an empty result indistinguishable from a transport failure.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` fails on baseline and then reports every snapshot pipeline with ordered stage ID, status, and workflow invocation ID; unknown IDs refuse by name.
- [ ] The live-snapshot regression in `v2/src/daemon/daemon-pipeline-observation.test.ts` fails on baseline and completes within its bound while a pipeline remains non-terminal.
- [ ] The wait regression in `v2/src/daemon/daemon-pipeline-observation.test.ts` fails on baseline and returns named `terminal` and `awaiting-approval` boundaries, including the approval stage ID.
- [ ] Inverting the snapshot non-follow and terminal/approval-boundary guards makes `v2/src/daemon/daemon-pipeline-observation.test.ts` fail.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline snapshot and wait request contracts, derived state, errors, and blocking boundaries.
