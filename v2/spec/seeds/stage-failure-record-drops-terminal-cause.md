---
name: stage-failure-record-drops-terminal-cause
---

# `stageFailedCause` reads `terminalCause` off a detail that no longer carries it

## Problem

`stageFailedCause` (`v2/src/daemon/operator-incidents.ts:220-223`) casts `stage.failureDetail` to `{ terminalCause?: unknown }` and maps `run_timeout` to its own incident cause. After #4108, `failureDetailForRun` (`v2/src/daemon/stage-settlement-owner.ts:42-53`) settles a bare `OperatorFailureRecord` whenever the run has one stored, and that record has no `terminalCause` field. The consumer is unchanged and now reads a property that is never present, so the `run_timeout` incident cause silently degrades to `failed` (`operator-incidents.ts:518` and `:597`).

## Evidence (2026-09-20)

The daemon's normal path is unaffected: it supplies `loadLogRecords`, and the value it previously composed (`composeRunOperatorError`, via the pre-#4108 `failureDetailFromLogs`) also lacked `terminalCause`, so that path already degraded.

The genuine new loss is the `loadLogRecords === undefined` path. Before #4108 no `failureDetailForRun` was supplied there at all, so settlement fell through to `stageFailureDetailFromEntryRun` (`v2/src/persistence/pipeline-stage-settlement.ts:149-160`, selected at `:271`), which carries `terminalCause`, `entryRunStatus`, `terminalFailureDetail` and `attempts`. Now a run *with* a stored record gets the bare record instead, and the envelope's fields are gone.

Subspec 01 of `serve-canonical-failures-from-daemon` (`v2/spec/20260912T175013Z-serve-canonical-failures-from-daemon/01-linked-stage-settlement-projects-run-record.md`) does not acknowledge this consumer.

## Decisions

- A stage settled from a stored `OperatorFailureRecord` still lets `stageFailedCause` distinguish a `run_timeout` from a plain `failed` — either the settled detail keeps `terminalCause`, or the consumer derives it from the record rather than from a field the record never has. Rules out leaving a dead property read in place.
- Narrow follow-up to #4108. No change to what the daemon path serves, to the record shape itself, or to any other incident derivation.

## Acceptance criteria

- [ ] A test proves a stage settled with no `loadLogRecords`, from a run whose stored record came from a timeout, derives the `run_timeout` incident cause; it fails against the current `stage.failureDetail.terminalCause` read.
- [ ] A test proves a non-timeout stored record still derives `failed`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None expected; note the settled-detail contract in `v2/docs/pipeline-execution.md` only if the detail shape changes.
