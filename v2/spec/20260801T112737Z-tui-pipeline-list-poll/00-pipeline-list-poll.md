# 00 - Pipeline list poll

## Problem

`runTuiEntry` polls `list` on the 1s refresh tick but never calls `pipeline_list`. Downstream
pipeline-tree work needs per-daemon observation on that cadence without a second timer.

## Prerequisites

- The TUI refresh tick polls `list` once per connected daemon (`v2/src/tui/tui-entry.tsx` `refreshRuns`).
- The daemon `pipeline_list` RPC returns pipeline snapshots with ordered stages including `branchKey` and `workflowInvocationId` (`v2/src/daemon/daemon-pipeline-observation.test.ts`).

## Decisions

- `pipeline_list` runs in the same `refreshRuns` pass as `list`, once per entry in the `clients` loop per tick — rules out a second scheduler or separate refresh cadence.
- Within a tick: non-invoking-socket `list` failure still runs `pipeline_list` for that client — observation is independent of list merge for other daemons.
- Invoking-socket `list` failure evicts the client from `clients`; that socket's `pipelineSnapshotsBySocketPath` entry is removed with the client — rules out stale per-daemon snapshots after disconnect.
- `pipeline_list` failure does not evict connections or clear merged run rows — rules out mirroring invoking-socket `list` eviction for observation errors.
- Last-good `{ pipelines }` per socket path replaces that entry only on successful `pipeline_list`; retained on `pipeline_list` failure and on non-evicting `list` failure — rules out clearing per-daemon snapshots on transient RPC errors.
- Successful `{ pipelines: [] }` overwrites a prior non-empty snapshot for that socket — daemon truth, not “never polled”.
- Add `pipelineSnapshotsBySocketPath: Readonly<Record<string, { pipelines: readonly PipelineSnapshot[] }>>` to `TuiMonitorState` (`PipelineSnapshot` from `v2/src/daemon/pipeline-observation.ts`); keys are daemon socket paths matching `clients` map keys; values are last-good daemon `pipeline_list` wire snapshots at implementation time (timing-field enrichment belongs to the tree-model sibling); `emptyMonitorState` initializes `{}` with no per-socket keys until a successful poll adds one — rules out seeding absent sockets with `{ pipelines: [] }`.
- Polled snapshots surface on `TuiMonitorState.pipelineSnapshotsBySocketPath` even though ink does not render them yet — rules out hiding data inside `tui-entry` with no monitor seam for tree wiring.
- Initial `refreshRuns(true)` polls `pipeline_list` alongside `list` and merges snapshots into `currentState` before `openMonitor` — rules out deferring observation until the first scheduler tick.
- Deferred to first consumer: how pipeline snapshots merge across multiple daemons — pin when monitor integration wires the tree.

## Tasks

- Add `pipelineList()` to `TuiDaemonClient` / `connectTuiDaemon`, parsing the daemon `pipeline_list` wire shape (`PipelineSnapshot`: `pipelineId`, `name`, `state`, ordered `stages` with `stageId`, `branchKey`, `status`, `workflowInvocationId`).
- In `refreshRuns`, call `pipelineList()` for each connected client on every tick (including initial), alongside `list()`; merge results into `pipelineSnapshotsBySocketPath` on `currentState` / `draftState`.
- Extend `tui-entry.test.tsx` fake clients with `pipelineListResponses` / `pipelineListError`; update existing per-tick `methods` sequence pins so each refresh tick expects `pipeline_list` alongside `list`.
- Add coverage for initial-tick polling, periodic cadence, pipeline-only monitor updates, run-row preservation on `pipeline_list` failure, last-good retention, client-eviction lifecycle, non-invoking `list` failure still polling `pipeline_list`, and empty-success overwrite.
- Add `tui-daemon-client.test.ts` coverage that `connectTuiDaemon` issues `pipeline_list` and parses full `PipelineSnapshot` stage rows.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — `refreshRuns(true)` against two connected daemons records exactly one `pipeline_list` per socket path in the `refreshRuns` client loop alongside `list`, and the `TuiMonitorState` passed to `openMonitor` carries per-socket `{ pipelines }` for each daemon; fails pre-fix when entry never calls `pipeline_list` or defers polling to the scheduler tick.
- [ ] `tui-entry.test.tsx` — a periodic refresh tick against two connected daemons records exactly one `pipeline_list` per socket path alongside `list` (per-fake-client call counts keyed by socket path); fails pre-fix when entry never calls `pipeline_list`.
- [ ] `tui-entry.test.tsx` — when `list` returns unchanged runs but `pipeline_list` returns new per-socket snapshots, monitor state updates with the new `pipelineSnapshotsBySocketPath` entries; fails when snapshots live off-state while run rows are stable.
- [ ] `tui-entry.test.tsx` — when `pipeline_list` throws for one daemon while `list` succeeds, the monitor stays open with that daemon's runs still rendered from the successful `list` merge; fails when failure clears run rows or closes the monitor.
- [ ] `tui-entry.test.tsx` — after a successful `pipeline_list` tick, a subsequent failing tick leaves `TuiMonitorState.pipelineSnapshotsBySocketPath[socketPath]` carrying the prior `{ pipelines }`; fails when failure clears the stored snapshot.
- [ ] `tui-entry.test.tsx` — invoking-socket `list` failure evicts the client and removes that socket's `pipelineSnapshotsBySocketPath` entry; a non-evicting `list` or `pipeline_list` failure on another tick retains other sockets' entries; fails when eviction leaves a stale snapshot or non-evicting failure drops retained snapshots.
- [ ] `tui-entry.test.tsx` — non-invoking-socket `list` failure on one daemon still issues `pipeline_list` for that daemon on the same tick; fails when `list` failure skips `pipeline_list`.
- [ ] `tui-entry.test.tsx` — successful `{ pipelines: [] }` overwrites a prior non-empty snapshot for that socket; fails when empty success is treated as “never polled” and retains stale pipelines.
- [ ] `tui-daemon-client.test.ts` — `connectTuiDaemon` `pipelineList` parses ordered `PipelineSnapshot` rows (`pipelineId`, `name`, `state`, stages with `stageId`, `branchKey`, `status`, `workflowInvocationId`); fails pre-fix without `pipelineList`.
- [ ] `tui-entry.test.tsx` — `Mutation checkpoint:` on the cadence pinning test names skipping `pipeline_list` on refresh; mutating that guard turns the cadence test RED.
- [ ] `tui-entry.test.tsx` — `Mutation checkpoint:` on the run-preservation test names evicting the client or closing the monitor on `pipeline_list` failure; mutating that guard turns the preservation test RED.
- [ ] `tui-entry.test.tsx` — `Mutation checkpoint:` on the run-preservation test names clearing merged run rows when `pipeline_list` fails while `list` succeeds; mutating that guard turns the preservation test RED.
- [ ] `tui-entry.test.tsx` — `Mutation checkpoint:` on the retention test names clearing per-daemon snapshots on `pipeline_list` failure; mutating that guard turns the retention test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.
