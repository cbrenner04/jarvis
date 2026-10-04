# 01 - List, wait, TUI, and log follow through rollover

## Problem

During in-loop rollover the run stays `in-progress` with attempt `outcomeKind: "iteration_timeout_continued"`, but workflow step snapshots and monitor rows can fall through to `stopped` / `invocation_failure` when the run is not in `liveRunIds`, so rollover reads as a failed workflow step while `jarvis run log` / TUI log follow already persist `boundary_committed.outcomeKind` for operators who tail the log.

## Decisions

- `workflowStepSnapshot` treats `run.status === "in-progress"` with last attempt `outcomeKind: "iteration_timeout_continued"` as step `in_progress` even when the run id is absent from `liveRunIds`; rules out mapping rollover mid-loop to `stopped` + `invocation_failure`.
- Top-level `jarvis run list` / `wait` rows for `in-progress` runs omit terminal `error` projection while rollover is in flight (no `loop_finished`); rules out synthesizing a failed terminal row from a non-terminal continued boundary.
- TUI monitor consumes the same daemon list rows as the CLI; no separate TUI-only status derivation for rollover beyond list projection.
- Log follow and `run log` JSONL remain passthrough of persisted `boundary_committed` events; pin `iteration_timeout_continued` in follow-line tests only when formatter behavior changes in this subspec.

## Task checklist

- [ ] Extend `stoppedOutcomeForRun` / `workflowStepSnapshot` (or equivalent list wiring) for `iteration_timeout_continued` in-progress rollover.
- [ ] Add or adjust daemon list/wait tests for in-progress rollover and for terminal `iteration_timeout` resume projection aligned with subspec 00.

## Acceptance criteria

- [ ] `workflow-list-snapshot.test.ts` asserts an `in-progress` durable step whose last attempt is `iteration_timeout_continued` projects `status: "in_progress"` with no `terminalOutcome` when `liveRunIds` is empty; it fails against the pre-fix code (stopped / `invocation_failure` today).
- [ ] `daemon-wait-run-completion.test.ts` adds a case asserting `list`/`wait` keep `status: "in-progress"` with no `error` when the store row is `in-progress`, the last attempt is `iteration_timeout_continued`, and no terminal `loop_finished` exists; it fails against the pre-fix code.
- [ ] `tui-log-follow-entry.test.tsx` `formatLogFollowLine` `projects per-kind fields from decisions` stays green (passthrough formatter unchanged unless this subspec edits it).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes for touched `src/daemon/**` and `src/tui/**` surfaces.

## Documentation updates

- Deferred to [02](./02-docs-iteration-timeout-operator-projection.md).
