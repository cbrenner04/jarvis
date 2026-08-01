# TUI elapsed columns render and local tick

Populate pipeline, stage, and run `elapsed` cells via [01](./01-elapsed-duration-formatter.md) and
advance active cells on a local display tick without extra `list` or `pipeline_list` RPC.

## Problem

The tree grid reserves `elapsed` width but every cell is empty. Operators cannot compare pipeline,
stage, or run age inside `jarvis tui` without `jarvis run list`.

## Prerequisites

- [00 - List run createdAt wire](./00-list-run-created-at-wire.md) merged — `DaemonListRunRow.createdAt`
  on the `list` wire.
- [01 - Elapsed duration formatter](./01-elapsed-duration-formatter.md) merged —
  `formatElapsedWallClock`.
- `pipeline_list` stage rows expose `startedAt` and `endedAt` (`projectPipelineSnapshot`).

## Decisions

- Single injected `nowMs` per paint/tick drives every elapsed cell — rules out per-row `Date.now()`.
- Pipeline elapsed: `snapshot.createdAt` → `snapshot.finishedAtMs ?? nowMs` — rules out stage-sum or
  run-min semantics.
- Stage elapsed: durable `startedAt` → `endedAt ?? nowMs` — rules out run-row inference.
- Run elapsed: `run.createdAt` → `run.finishedAtMs ?? nowMs` — rules out attempt `startedAt`; collapsed
  workflow rows use the representative run's `createdAt` / `finishedAtMs`.
- Elapsed freezes only when the recorded end timestamp is present (`finishedAtMs`, `endedAt`), not when
  status alone is terminal — rules out implying freeze from status without an end time.
- `formatElapsedWallClock` output is passed through existing `formatTreeCell` width padding for the
  `elapsed` column — rules out a second truncation path.
- Local display tick rerenders the ink monitor with advancing `nowMs` only; it does not call
  `refreshRuns`, `list`, or `pipeline_list` — rules out faster refresh polling to move the clock.
- Display tick interval matches `TUI_REFRESH_INTERVAL_MS` (1s) but runs on an injectable scheduler
  seam distinct from `TUI_REFRESH_INTERVAL_MS` refresh polling — rules out coupling display clock to
  RPC refresh.
- Tests inject fixed `nowMs` and schedulers; assert formatted `elapsed` cell substrings via pure row
  builders or monitor derivation — rules out painted ink assertions.

## Tasks

- Thread stage `startedAt`/`endedAt` into stage tree row build (`buildStageMonitorTreeRow` or
  equivalent) from `PipelineSnapshot` stage data.
- Populate `elapsed` in `buildPipelineMonitorTreeRow`, `buildStageMonitorTreeRow`, and run
  `monitorTreeCellValue` via `formatElapsedWallClock`.
- Add injectable display-tick scheduler to monitor session deps; wire `openInkMonitor` /
  `runTuiEntry` to rerender on tick without RPC.
- Extend `tui-monitor-pipeline-tree.test.ts` for independent pipeline/stage/run elapsed strings on
  active and terminal fixtures, plus empty elapsed when stage `startedAt` is `null`.
- Extend `tui-shell-layout.test.ts` for run-row `elapsed` from `createdAt`/`finishedAtMs`.
- Add `tui-entry.test.tsx` — `display tick advances elapsed without additional list or pipeline_list
  RPC` counting RPC methods across display ticks while `refresh` scheduler is idle.
- Add `Mutation checkpoint:` comments on pins for terminal freeze, `null` start empty cell, and
  display-tick/no-RPC guard.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` for `jarvis tui` elapsed
  semantics.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-monitor-pipeline-tree.test.ts` — `active pipeline stage and run rows render independent elapsed from injected nowMs` fails pre-fix and passes after implementation; pin asserts three distinct formatted values from pipeline `createdAt`, stage `startedAt`, and run `createdAt`.
- [x] `tui-monitor-pipeline-tree.test.ts` — `terminal pipeline stage and run rows freeze elapsed at recorded end times` fails pre-fix and passes after implementation; advancing `nowMs` leaves all three elapsed cells unchanged.
- [x] `tui-monitor-pipeline-tree.test.ts` — `stage row elapsed is empty when startedAt is null` fails pre-fix and passes after implementation — rules out `0s` when start is unset.
- [x] `tui-entry.test.tsx` — `display tick advances elapsed without additional list or pipeline_list RPC` fails pre-fix and passes after implementation; pin drives display ticks with refresh scheduler idle and asserts RPC counts unchanged while elapsed cell text changes.
- [x] `tui-monitor-pipeline-tree.test.ts` and `tui-entry.test.tsx` — `Mutation checkpoint:` comments name guard-inversion mutations for terminal freeze, null/ absent start, and display-tick/no-RPC; inverting each named guard turns the corresponding pin RED.
- [x] `v2/docs/operator-runbook.md` — `jarvis tui` row documents what elapsed measures at pipeline, stage, and run levels; collapsed workflow rows use the representative run's `createdAt` / `finishedAtMs`; elapsed freezes only when the recorded end timestamp is present (`finishedAtMs`, `endedAt`) and keeps advancing on the local tick when status is terminal but the end timestamp is absent.
- [x] `v2/docs/v1-behaviors.md` — `jarvis tui` entry records elapsed columns, collapsed-workflow run elapsed from the representative run's timestamps, and the end-timestamp freeze rule (not status alone).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row: elapsed semantics per tree level, collapsed-workflow
  run elapsed, and end-timestamp freeze (not status alone).
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records elapsed columns, collapsed-workflow semantics,
  and end-timestamp freeze.
