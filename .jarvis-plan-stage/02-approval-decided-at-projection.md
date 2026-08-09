# Approval decision timestamp on `pipeline_list`

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`StateStore.commitApprovalDecision` stamps `pipeline_stages.decided_at` and `loadPipeline` exposes it as `PipelineStageRecord.decidedAt`, but `projectPipelineSnapshot` (`v2/src/daemon/pipeline-observation.ts`) does not copy it onto the projected stage shape, so `pipeline_list` carries no record of when a gate was decided. The same projection is the only wire evidence that a stage which failed before start keeps `startedAt` null, and nothing pins that it is passed through rather than synthesized.

## Decision ledger

- `decidedAt: number | null` is a required field on the projected stage shape, matching `startedAt`/`endedAt` — rules out an optional field, where an absent value could not be distinguished from an undecided gate by a consumer.
- The value is the durable column, projected unchanged; an undecided or boundary-only (`awaiting`) gate projects `null` — rules out deriving a decision time from `endedAt`, which a decided gate does not have.
- TUI stage fixtures gain `decidedAt` only to satisfy the required field; no TUI rendering or selection behavior changes here.

## Prerequisites

- `PipelineStageRecord.decidedAt` is selected by `STAGE_COLUMNS` and stamped by `commitApprovalDecision` (`v2/src/persistence/state-store.ts`); `commitApprovalBoundary` leaves it `NULL`.
- `projectPipelineSnapshot` backs the `pipeline_list` RPC and projects durable stage rows without following live transitions (`v2/src/daemon/pipeline-observation.ts`).
- `daemon-pipeline-observation.test.ts`'s `projectedStage` helper matches with `expect.objectContaining`, so an added projected field does not break existing expectations.

## Tasks

- `v2/src/daemon/pipeline-observation.ts` — `PipelineSnapshot["stages"][number]` gains `decidedAt: number | null`; `projectPipelineSnapshot`'s stage map gains `decidedAt: stage.decidedAt,` (one physical line, mutation anchor).
- Stage fixtures that construct `PipelineSnapshot["stages"][number]` gain `decidedAt: null`: the `snapshotStage` helpers in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` and `v2/src/tui/tui-monitor-lines.test.ts`, and the literals in `v2/src/tui/tui-entry.test.tsx`, `v2/src/tui/tui-ink-monitor.test.tsx`, `v2/src/tui/tui-daemon-client.test.ts` (typecheck names each site).
- Tests — `v2/src/daemon/daemon-pipeline-observation.test.ts`:
  - `pipeline_list projects the approval decision timestamp on a decided gate`: seed an approval-gate pipeline in the store (model on `two-branch pipeline_list projection includes branchKey per durable row`), decide the gate through `stateStore.commitApprovalDecision` for `approved` and for `rejected`, and assert the `pipeline_list` stage row's `decidedAt` equals the durable row's non-null `decidedAt`. Carries the keystone `// @mutate`.
  - `an undecided approval stage projects a null decidedAt`: a `pending` gate and an `awaiting` gate committed through `commitApprovalBoundary` both project `decidedAt: null`. Carries the no-synthesis `// @mutate`.
  - `pipeline_list projects a stage that failed before start with a null startedAt`: a durable stage row with `status: "failed"`, a numeric `endedAt`, and `startedAt: null` projects `startedAt: null`.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects the approval decision timestamp on a decided gate` asserts an approved gate and a rejected gate each project the durable non-null `decidedAt`; it fails against the pre-fix code, whose projected stage shape has no `decidedAt`.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `an undecided approval stage projects a null decidedAt` asserts a `pending` gate and a boundary-committed `awaiting` gate both project `null`.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects a stage that failed before start with a null startedAt` asserts the failed-before-start row projects `startedAt: null` with its `endedAt` intact, rather than a synthesized start.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects the approval decision timestamp on a decided gate`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: null,"` inside the test body — baseline semantics where the wire carries no gate decision time — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `an undecided approval stage projects a null decidedAt`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: Date.now(),"` inside the test body — a decision time synthesized for a gate that was never decided — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `projectPipelineSnapshot includes stage startedAt and endedAt from durable records` and `pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection` stay green (existing projected fields unchanged by the addition).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC table `pipeline_list` row and the § Pipeline snapshots response example — the projected stage shape gains `decidedAt`: the durable approval decision timestamp (ms since epoch), `null` until `approve`/`reject` decides the gate; `startedAt` stays `null` on a stage that failed before start.
- `v2/docs/v1-behaviors.md` — record that `pipeline_list` now projects per-stage `decidedAt` from the durable approval decision column, `null` on undecided gates. Amend the existing entry enumerating the `pipeline_list` stage projection fields.
