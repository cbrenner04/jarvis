# Approval decision timestamps and pipeline finish

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Approval decisions durably stamp `PipelineStageRecord.decidedAt`, but `projectPipelineSnapshot` omits it and pipeline finish derivation ignores a rejected gate or an approved final gate when neither has `endedAt`.

## Decision ledger

- Every projected stage carries durable `decidedAt`, numeric for a decided approval and `null` otherwise. Rules out optional omission, consumer-side lookup, and deriving a decision time from `endedAt`.
- For a terminal pipeline, `derivePipelineFinishedAtMs` uses `terminalPublicationSucceededAt` when set; otherwise it takes the latest non-null durable stage `endedAt` or approval `decidedAt`, and falls back to `createdAt` only when neither exists. This makes a rejection and an approved final gate durable finish candidates. Rules out terminal pipelines appearing to finish at creation despite a later gate decision.
- `approved` and `rejected` are approval decisions, not terminal stage-run statuses; their `decidedAt` participation in pipeline finish derivation does not extend the stage-run `endedAt` invariant.
- No TUI rendering consumes `decidedAt` in this slice. Rules out coupling the wire addition to later work/idle presentation.

## Prerequisites

- `commitApprovalDecision` stamps `decidedAt` atomically for `approved` and `rejected`; `loadPipeline` and `listPipelines` expose it on every stage record.
- `pipeline_list` maps `StateStore.listPipelines()` through `projectPipelineSnapshot` without following live transitions.

## Tasks

- Add `decidedAt: number | null` to the projected stage shape and copy it with the unique line `decidedAt: stage.decidedAt,` in `v2/src/daemon/pipeline-observation.ts` for the mutation anchor.
- Update `derivePipelineFinishedAtMs` to include durable approval `decidedAt` values with stage `endedAt` values after the terminal-publication-success override, using the unique line `const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt, stage.decidedAt]);` for the finish-source mutation anchor.
- Update projection fixtures to expect `decidedAt: null` on undecided/non-approval rows.
- Add `daemon-pipeline-observation.test.ts` coverage that decides separate gates through approve and reject paths, compares their durable and wire timestamps, and proves rejected and approved-final terminal pipelines use `decidedAt` as `finishedAtMs` when no later source exists.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates` approves one gate and rejects another, asserts each durable decision timestamp is non-null and unchanged on the matching wire stage, and fails against the pre-fix projection that omits `decidedAt`.
- [ ] `pipeline_list` returns `decidedAt: null` on undecided approval stages and non-approval stages rather than omitting or synthesizing a value.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline finish uses approval decidedAt for rejected and approved-final gates` constructs a rejected pipeline and a pipeline terminating at an approved final gate without later `endedAt` or publication success, asserts each `finishedAtMs` equals its durable `decidedAt`, and fails against the pre-fix created-at fallback.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates`; Keystone checkpoint: its test body carries `// @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: null,"`, suppressing the durable approval timestamp, and the mutation turns the regression RED.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list projects decidedAt for approved and rejected gates`; Mutation checkpoint: the linked projection mutation proves the test fails when a decided row is flattened to the undecided shape.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline finish uses approval decidedAt for rejected and approved-final gates`; Mutation checkpoint: its test body carries `// @mutate v2/src/daemon/pipeline-observation.ts "const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt, stage.decidedAt]);" -> "const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt]);"`, removing the approval-decision finish source, and the mutation turns the regression RED.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document approval `decidedAt` on the `pipeline_list` stage shape and its durable finish-candidate role for terminal rejected and approved-final pipelines.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods `pipeline_list` row — add `decidedAt` to the stage shape; it is the durable approval decision epoch milliseconds and is `null` before decision and on non-approval stages. For terminal rejected and approved-final pipelines, it is a `finishedAtMs` candidate when no terminal-publication success timestamp exists.
- `v2/docs/v1-behaviors.md` — record that `pipeline_list` projects durable approval decision timestamps and uses them to derive terminal finish when a rejected or approved-final gate has no later durable finish source.
