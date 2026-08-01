---
name: tui-pipeline-list-poll
---

# TUI pipeline_list polling

Poll `pipeline_list` on the same refresh tick as `list` against the same discovered daemons. Degrade
gracefully when the RPC fails.

## Problem

Nothing in the TUI fetches pipeline snapshots today. Slice 2 needs observation data on the existing
1s refresh cadence without a second timer or separate poll loop.

## Decisions

- `pipeline_list` runs on the same refresh tick as `list` against the same connected daemons — rules out a second timer or separate refresh cadence.
- A `pipeline_list` RPC failure leaves run rows rendered — rules out crashing or clearing the pane on pipeline observation errors.
- Deferred to first consumer: how pipeline snapshots merge across multiple daemons — pin when monitor integration wires the tree.

## Acceptance criteria

- [ ] The TUI issues `pipeline_list` once per refresh tick per connected daemon, and a `pipeline_list` RPC failure leaves the run rows rendered (degraded, not crashed).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.

## Prerequisites

- The TUI refresh tick polls `list` once per connected daemon.
- The daemon `pipeline_list` RPC returns pipeline snapshots with ordered stages including `branchKey` and `workflowInvocationId`.
