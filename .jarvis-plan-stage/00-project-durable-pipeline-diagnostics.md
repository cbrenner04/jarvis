# 00 - Project durable pipeline diagnostics

## Problem

`pipeline_list` omits terminal publication, admission seed-path, and stage diagnostics already retained by durable pipeline records, forcing observation clients to work without authoritative detail.

## Decisions

- Add the fields to the existing parameterless snapshot — rules out a detail RPC or persistence access from clients.
- Project pipeline `terminalAction`, admission `seedPath`, `terminalPublicationSucceededAt`, and `terminalPublicationFailure` directly from the loaded record — rules out client reconstruction or a persistence migration.
- Project stage record `id`, authored `position`, `artifact`, and `failureDetail` directly and preserve nullable JSON values — rules out truthiness filtering or diagnostic synthesis.
- Preserve durable stage order, derived state, timing fields, and one-shot list behavior — rules out a `pipeline_list` redesign.
- Keep TUI rendering out of scope — rules out coupling daemon projection to presentation.

## Work

- Extend `PipelineSnapshot` and `projectPipelineSnapshot` with the durable pipeline and stage fields.
- Extend `daemon-pipeline-observation.test.ts` with stored-record projection pins and the required mutation directives.
- Align the daemon IPC, CLI output, operator snapshot, and v1-parity documentation contracts.

## Acceptance criteria

- [ ] `pipeline_list` returns stored pipeline `terminalAction`, admission `seedPath`, `terminalPublicationSucceededAt`, and `terminalPublicationFailure` without changing derived state, timing, or parameterless one-shot semantics.
- [ ] `pipeline_list` returns each stored stage record's `id`, authored `position`, `artifact`, and `failureDetail`, preserving nullable JSON values and stored stage order.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` adds terminal/admission and stage-diagnostic regression expectations that fail against the baseline projection and pass after implementation.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` carries `// @mutate v2/src/daemon/pipeline-observation.ts "terminalAction: pipeline.definition.terminalAction," -> "terminalAction: undefined,"`; its terminal/admission projection pin fails under that source mutation.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` carries `// @mutate v2/src/daemon/pipeline-observation.ts "artifact: stage.artifact," -> "artifact: null,"`; its stage-diagnostic projection pin fails under that source mutation.
- [ ] No production guard is added or modified; the projection remains unconditional and the two source-mutation checkpoints above turn their corresponding tests red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — extend the `pipeline_list` IPC and durable snapshot contracts.
- `v2/docs/write-behavior.md` — extend the `jarvis pipeline list` JSON output contract.
- `v2/docs/operator-runbook.md` — extend the point-in-time pipeline snapshot field list.
- `v2/docs/v1-behaviors.md` — record the additive v2 observation fields.
