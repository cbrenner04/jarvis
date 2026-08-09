# Approval `decidedAt` on `pipeline_list`

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`commitApprovalDecision` stamps `pipeline_stages.decided_at` and `loadPipeline`/`listPipelines` expose it, but `projectPipelineSnapshot` (`v2/src/daemon/pipeline-observation.ts:175`) does not map it, so an approved or rejected gate reaches `pipeline_list` with no decision time and observers cannot tell when a gate was decided. The same projection's `startedAt` pass-through — the field a failed-before-start stage leaves null — has no test naming that shape.

## Decision ledger

- `decidedAt` is a required `number | null` on the projected stage, matching every other durable stage field on the snapshot — rules out an optional field, which would make an undecided gate and a stage from an older daemon indistinguishable on the wire.
- The projection passes the durable value through with no derivation: a gate the store left `NULL` projects `null` — rules out synthesizing a decision time from `endedAt` or the row's status.
- `endedAt` is not overloaded for gate decisions; `decidedAt` stays the only decision timestamp on an approval row, consistent with the store's terminal-set exclusion of `approved`/`rejected`.
- TUI consumers are not changed here; the field is projected for later seeds. Deferred to first consumer: how a decided gate renders its decision time — pin when a caller needs it.

## Prerequisites

- `PipelineStageRecord.decidedAt` is populated by `loadPipeline`/`listPipelines` and stamped only by `commitApprovalDecision` (`v2/src/persistence/state-store.ts`, migration `024-pipeline-stage-decided-at`).
- `pipeline_approve` / `pipeline_reject` handlers reach `commitPipelineApprovalDecision`, which requires the addressed row to be `awaiting`.
- `daemon-pipeline-observation.test.ts` already builds approval fixtures (`WITH_APPROVAL`, `pipelineWithStages`, `projectedStage`) and drives handlers through `createRunControlHandlers`.

## Tasks

- `v2/src/daemon/pipeline-observation.ts`:
  - `PipelineSnapshot["stages"][number]` gains `decidedAt: number | null;`.
  - The stage map gains `decidedAt: stage.decidedAt,` — the mutation anchor, unique in the file.
- Tests — `v2/src/daemon/daemon-pipeline-observation.test.ts`:
  - `pipeline_list projects the approval decision timestamp on a decided gate`: drive one gate row to `awaiting` and approve it through `pipeline_approve`, and a second pipeline's gate through `pipeline_reject`; assert each projected stage row's `decidedAt` is a number equal to the durable row's. Carries the keystone `// @mutate`.
  - `pipeline_list projects null decidedAt for an undecided gate`: assert a `pending` and an `awaiting` gate both project `decidedAt: null`. Carries the pass-through guard `// @mutate`.
  - `pipeline_list projects a stage that failed before start with a null startedAt`: seed a stage row `failed` with `endedAt` set and `startedAt` null; assert the projection reports `startedAt: null` and that `endedAt`.
- Update fixtures that construct a `PipelineSnapshot` stage object to carry `decidedAt` (`v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `tui-monitor-lines.test.ts`, `tui-entry.test.tsx`, `tui-ink-monitor.test.tsx`, `tui-daemon-client.test.ts` as typecheck requires) — mechanical, no TUI behavior change.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects the approval decision timestamp on a decided gate` approves one gate and rejects another through the daemon handlers and asserts each projected stage row carries the durable `decidedAt`; it fails against the pre-fix code, whose projection omits the field.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects null decidedAt for an undecided gate` asserts a `pending` and an `awaiting` gate project `decidedAt: null`, so no decision time is synthesized for an undecided row.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects a stage that failed before start with a null startedAt` asserts a terminal stage with `endedAt` set and `startedAt` null projects `startedAt: null` rather than a synthesized start.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects the approval decision timestamp on a decided gate`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: null,"` inside the test body — baseline semantics where a decided gate reaches the wire with no decision time — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects null decidedAt for an undecided gate`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: Date.now(),"` inside the test body — a projection that invents a decision time for an undecided row — and the mutation turns that regression RED.
- [ ] Existing `v2/src/daemon/daemon-pipeline-observation.test.ts` projection tests (`pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection`, and the fan-out branch projection tests) stay green.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` record `decidedAt` on the projected `pipeline_list` stage shape and that stage `startedAt` stays null on a stage that failed before start.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods, `pipeline_list` row — the projected stage shape gains `decidedAt`: the durable approval decision timestamp (ms since epoch), `null` on undecided and non-approval rows, passed through with no derivation. `startedAt` stays `null` on a stage that failed before start, even when `endedAt` is set.
- `v2/docs/daemon-host.md` § Pipeline snapshots — same addition in the payload sketch and prose.
- `v2/docs/v1-behaviors.md` — update the `pipeline_list` snapshot entry: stage projections now carry `decidedAt`, so a gate's decision time is observable on the wire where it previously was not.
