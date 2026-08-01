# 00 - Pipeline list poll

## Problem

`runTuiEntry` polls `list` on the 1s refresh tick but never calls `pipeline_list`. Downstream
pipeline-tree work needs per-daemon observation on that cadence without a second timer.

## Prerequisites

- The TUI refresh tick polls `list` once per connected daemon (`v2/src/tui/tui-entry.tsx` `refreshRuns`).
- The daemon `pipeline_list` RPC returns pipeline snapshots with ordered stages including `branchKey` and `workflowInvocationId` (`v2/src/daemon/daemon-pipeline-observation.test.ts`).

## Decisions

- `pipeline_list` runs in the same `refreshRuns` pass as `list`, once per connected daemon per tick — rules out a second scheduler or separate refresh cadence.
- `pipeline_list` failure does not evict connections or clear merged run rows — rules out mirroring invoking-socket `list` eviction for observation errors.
- Last-good `{ pipelines }` per socket path replaces that entry only on success and is retained on failure — rules out clearing per-daemon snapshots on transient RPC errors.
- Polled snapshots surface on `TuiMonitorState` keyed by socket path even though ink does not render them yet — rules out hiding data inside `tui-entry` with no monitor seam for tree wiring.
- Deferred to first consumer: how pipeline snapshots merge across multiple daemons — pin when monitor integration wires the tree.

## Tasks

- Add `pipelineList()` to `TuiDaemonClient` / `connectTuiDaemon`, parsing the daemon `pipeline_list` wire shape (`PipelineSnapshot` stages include `stageId`, `branchKey`, `status`, `workflowInvocationId`).
- In `refreshRuns`, call `pipelineList()` for each connected client on every tick (including initial), alongside `list()`.
- Maintain per-socket last-good pipeline snapshots; expose them on `TuiMonitorState`.
- Extend `tui-entry.test.tsx` fake clients with `pipelineListResponses` / `pipelineListError`; add coverage for per-tick RPC cadence, run-row preservation on `pipeline_list` failure, and last-good retention across a failing tick.
- Add `tui-daemon-client.test.ts` coverage that `connectTuiDaemon` issues `pipeline_list` and parses stage rows.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — a refresh tick against two connected daemons records exactly one `pipeline_list` per daemon alongside `list`; the test fails against the pre-fix entry that never calls `pipeline_list`.
- [ ] `tui-entry.test.tsx` — when `pipeline_list` throws for one daemon while `list` succeeds, the monitor stays open with that daemon's runs still rendered from the successful `list` merge.
- [ ] `tui-entry.test.tsx` — after a successful `pipeline_list` tick, a subsequent failing tick leaves `TuiMonitorState` carrying the prior per-daemon `{ pipelines }` for that socket; the test fails when failure clears the stored snapshot.
- [ ] `tui-daemon-client.test.ts` — `connectTuiDaemon` `pipelineList` parses ordered stage rows with `branchKey` and `workflowInvocationId`; the test fails against the pre-fix client without `pipelineList`.
- [ ] `tui-entry.test.tsx` — mutating the last-good retention guard (clearing per-daemon snapshots on `pipeline_list` failure) turns the retention test RED; `Mutation checkpoint:` on that test names the mutation.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.
