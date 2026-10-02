# Persist per-lane terminal publication and fan-out pipeline aggregation

## Problem

`commitTerminalPublicationFailure` and `commitTerminalPublicationSuccess` update only `pipelines` columns. Fan-out lanes have no durable place for publication outcome on the implement row, and pipeline-level failure cannot name which lane failed without overloading `failure.message`.

## Prerequisites

- Pipeline-level `commitTerminalPublicationFailure` / `commitTerminalPublicationSuccess` first-write idempotency on `pipelines` (`state-store.test.ts` — `commitTerminalPublicationFailure stamps first write and is idempotent`, `commitTerminalPublicationSuccess stamps first write and is idempotent`).
- Fan-out durable rows keyed by `(pipelineId, stageId, branchKey)` with `createPipelineStageBranch` and per-branch lifecycle patches (`state-store.md` `updateStage` / reopen helpers).
- `PipelineTerminalPublicationFailure` and `PublicationFailure` shapes on the pipeline row (`state-store.ts`).

## Decisions

- Per-lane publication outcome is additive JSON on the lane's last `succeeded` workflow stage `artifact`: `terminalPublication: { succeededAt: number }` or `terminalPublication: { failure: PublicationFailure }` — rules out storing lane outcome only on the pipeline row or only in `failure.message`.
- `commitTerminalPublicationFailure` and `commitTerminalPublicationSuccess` accept optional `branchKey`; omission retains today's single-lane pipeline-column-only writes — rules out breaking default-branch callers and rules out a separate commit API surface for lanes.
- When `branchKey` names a non-`default` lane, each commit patches that lane's final succeeded workflow stage artifact (merge `terminalPublication` into the existing pointer envelope without dropping other artifact fields) and then reconciles pipeline-level markers from all fan-out branch keys on the admitted definition — rules out updating pipeline success after one lane while a sibling lane lacks publication.
- Pipeline `terminalPublicationSucceededAt` is stamped only when every named fan-out branch has `terminalPublication.succeededAt` on its final succeeded workflow stage; until then pipeline success and failure columns stay unset — rules out pipeline-level success with an unpublished sibling lane.
- Fan-out pipeline `terminalPublicationFailure` extends `PipelineTerminalPublicationFailure` with optional `branchKey` (exactly one failing lane on first durable failure) or `branchKeys` (when aggregation records multiple lanes that already carry `terminalPublication.failure`); lane identity is never carried only in `failure.message` — rules out operators inferring lane from free-text messages alone.
- Pipeline-level terminal publication columns keep first-write-wins idempotency: an existing `terminal_publication_failure` or `terminal_publication_succeeded_at` blocks overwrites from later per-lane commits, including cross-lane success after a recorded pipeline failure — rules out fan-out aggregation weakening the existing idempotent pipeline stamp contract.
- Per-lane artifact `terminalPublication` is first-write-wins on that stage row (repeat commits for the same lane leave the first stamp) — rules out oscillating lane rows when settlement retries.
- Single-lane pipelines (`default` branch only, or commits without `branchKey`): pipeline-column behavior and artifact shape stay byte-compatible with today; `terminalPublication` on stage artifacts is not written — rules out widening the common `pipeline list` artifact envelope without fan-out.
- Deferred to first consumer: daemon `resolveTerminalPublicationInput` / `runPipeline` calling per-lane commits and derived-state settlement — pin when seed `pipeline-fan-out-per-lane-terminal-settlement` wires execution.
- Deferred to first consumer: whether `reopenFailedPipeline` clears per-lane `terminalPublication` on reopen — pin when resume consumes lane publication failures.

## Task checklist

- Export a `StageTerminalPublication` (or equivalent) type and extend the documented stage `artifact` envelope with optional `terminalPublication`.
- Extend `PipelineTerminalPublicationFailure` with optional `branchKey` / `branchKeys` for fan-out aggregation reads.
- Implement fan-out branch enumeration and "final succeeded workflow stage per `branchKey`" resolution inside `state-store.ts` (reuse admitted `definition` + durable rows; do not import daemon execution modules).
- Extend `commitTerminalPublicationFailure` / `commitTerminalPublicationSuccess` with optional `branchKey`, per-lane artifact patch, and pipeline aggregation transaction.
- Add `state-store.test.ts` two-lane fixtures (shared prefix + two named branches, each with a terminal succeeded workflow stage and PR pointer artifact) covering all-lane success, single-lane failure with `branchKey`, multi-lane failure with `branchKeys` if constructible in one fixture, per-lane artifact fields, and repeat-commit idempotency on pipeline markers.
- Confirm existing single-lane terminal publication commit tests stay green without artifact mutation.

## Acceptance criteria

- [x] `state-store.test.ts` — new fan-out test: after per-lane `commitTerminalPublicationSuccess` on a two-lane fixture, each lane's final succeeded workflow stage artifact includes `terminalPublication.succeededAt` and the pipeline row has `terminalPublicationSucceededAt` set with `terminalPublicationFailure` null; fails against the pre-fix store that only updates pipeline columns.
- [x] `state-store.test.ts` — new fan-out test: after per-lane `commitTerminalPublicationFailure` on one lane of a two-lane fixture, that lane's artifact carries `terminalPublication.failure`, the pipeline row carries `terminalPublicationFailure` including `branchKey` (not message-only lane identity), and `terminalPublicationSucceededAt` stays null; fails against the pre-fix store that only updates pipeline columns.
- [x] `state-store.test.ts` — new fan-out test: with one lane publication failure committed, repeat `commitTerminalPublicationFailure` and `commitTerminalPublicationSuccess` (same and other lanes) leave pipeline `terminalPublicationFailure` / `terminalPublicationSucceededAt` unchanged from the first write, matching the idempotency contract exercised in `commitTerminalPublicationFailure stamps first write and is idempotent` and `commitTerminalPublicationSuccess stamps first write and is idempotent`; fails against pre-fix fan-out aggregation that only touched pipeline columns.
- [x] `state-store.test.ts` — `commitTerminalPublicationFailure stamps first write and is idempotent` and `commitTerminalPublicationSuccess stamps first write and is idempotent` stay green (single-lane pipeline-column behavior unchanged).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document optional `branchKey` on terminal publication commits, per-lane `terminalPublication` on workflow stage artifacts, fan-out pipeline aggregation rules, and extended `terminalPublicationFailure` lane fields.
- `v2/docs/v1-behaviors.md` — record fan-out per-lane terminal publication persistence and pipeline aggregation (execution settlement remains separate).
