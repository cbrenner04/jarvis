# Approval decision timestamp on pipeline list

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Approval decisions durably stamp `PipelineStageRecord.decidedAt`, but `projectPipelineSnapshot` omits it. `pipeline_list` therefore cannot report when an approved or rejected gate was decided.

## Decision ledger

- Every projected stage carries durable `decidedAt`, numeric for a decided approval and `null` otherwise. Rules out optional omission, consumer-side lookup, and deriving a decision time from `endedAt`.
- No TUI rendering consumes `decidedAt` in this slice. Rules out coupling the wire addition to later work/idle presentation.

## Prerequisites

- `commitApprovalDecision` stamps `decidedAt` atomically for `approved` and `rejected`; `loadPipeline` and `listPipelines` expose it on every stage record.
- `pipeline_list` maps `StateStore.listPipelines()` through `projectPipelineSnapshot` without following live transitions.

## Tasks

- Add `decidedAt: number | null` to the projected stage shape and copy it with the unique line `decidedAt: stage.decidedAt,` in `v2/src/daemon/pipeline-observation.ts` for the mutation anchor.
- Update projection fixtures to expect `decidedAt: null` on undecided/non-approval rows.
- Add `daemon-pipeline-observation.test.ts` coverage that decides separate gates through approve and reject paths, calls `pipeline_list`, and asserts each wire value equals the durable stage row's non-null `decidedAt`.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates` approves one gate and rejects another, asserts each durable decision timestamp is non-null and unchanged on the matching wire stage, and fails against the pre-fix projection that omits `decidedAt`.
- [ ] `pipeline_list` returns `decidedAt: null` on undecided approval stages and non-approval stages rather than omitting or synthesizing a value.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates`; Keystone checkpoint: its test body carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: null,"`, suppressing the durable approval timestamp, and the mutation turns the regression RED.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates`; Mutation checkpoint: the linked projection mutation proves the test fails when a decided row is flattened to the undecided shape.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document approval `decidedAt` on the `pipeline_list` stage shape.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods `pipeline_list` row — add `decidedAt` to the stage shape; it is the durable approval decision epoch milliseconds and is `null` before decision and on non-approval stages.
- `v2/docs/v1-behaviors.md` — record that `pipeline_list` now projects durable approval decision timestamps for approved and rejected gates.
