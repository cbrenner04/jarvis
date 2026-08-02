# 00 - Project durable pipeline diagnostics

## Problem

`pipeline_list` omits terminal publication, admission seed-path, and stage diagnostics already retained by durable pipeline records, forcing observation clients to work without authoritative detail.

## Decisions

- Add the fields to the existing parameterless snapshot — rules out a detail RPC or persistence access from clients.
- Add top-level `terminalAction`, `seedPath`, `terminalPublicationSucceededAt`, and `terminalPublicationFailure` to each pipeline snapshot. `terminalAction` comes from `pipeline.definition`; `seedPath` comes unchanged from `pipeline.context.seedPath` and may be relative to admission `cwd` (do not add `cwd`). Optional `terminalAction` and `seedPath` are omitted from JSON when absent; the two terminal-publication fields serialize as `null` when unset — rules out client reconstruction or a persistence migration.
- Project stage record `id`, authored `position`, `artifact`, and `failureDetail` directly and preserve nullable JSON values — rules out truthiness filtering or diagnostic synthesis.
- Preserve durable stage order, derived state, timing fields, and one-shot list behavior — rules out a `pipeline_list` redesign.
- Keep TUI rendering out of scope — rules out coupling daemon projection to presentation.

## Work

- Extend `PipelineSnapshot` and `projectPipelineSnapshot` with the durable pipeline and stage fields.
- Extend `daemon-pipeline-observation.test.ts` with stored-record projection pins for separate terminal-publication success and failure records, including the mutually exclusive nullable counterpart; pin falsy non-null stage JSON diagnostics.
- Extend the exact-output `pipeline list` regression in `v2/src/commands/pipeline.test.ts` with the new JSON fields and omitted-versus-`null` semantics.
- Align the daemon IPC, CLI output, operator snapshot, and v1-parity documentation contracts.

## Acceptance criteria

- [x] Each `pipeline_list` snapshot adds top-level `terminalAction` from the admitted definition and unchanged `seedPath` from durable admission context; absent optional values are omitted from the JSON wire result, and `seedPath` may remain relative to admission `cwd` without exposing `cwd`.
- [x] Each `pipeline_list` snapshot adds nullable `terminalPublicationSucceededAt` and `terminalPublicationFailure`; daemon regression records separately pin success with `terminalPublicationFailure: null` and failure with `terminalPublicationSucceededAt: null`.
- [x] Each `pipeline_list` stage adds durable `id`, authored `position`, `artifact`, and `failureDetail`; regression expectations retain stored order and distinguish `null` from falsy non-null JSON values such as `false`, `0`, and `""`.
- [x] `v2/src/daemon/daemon-pipeline-observation.test.ts` adds terminal/admission and stage-diagnostic regression expectations that fail against the baseline projection and pass after implementation.
- [x] `v2/src/daemon/daemon-pipeline-observation.test.ts` carries `// @mutate v2/src/daemon/pipeline-observation.ts "terminalAction: pipeline.definition.terminalAction," -> "terminalAction: undefined,"`; its terminal/admission projection pin fails under that source mutation.
- [x] `v2/src/daemon/daemon-pipeline-observation.test.ts` carries `// @mutate v2/src/daemon/pipeline-observation.ts "artifact: stage.artifact," -> "artifact: null,"`; its stage-diagnostic projection pin fails under that source mutation.
- [x] No production guard is added or modified; the projection remains unconditional and the two source-mutation checkpoints above turn their corresponding tests red.
- [x] `v2/src/daemon/daemon-pipeline-observation.test.ts` tests `pipeline_list distinguishes all derived states and classifies only terminal states as terminal`, `pipeline_list preserves authored stage order from durable position, not insertion order`, `projectPipelineSnapshot includes stage startedAt and endedAt from durable records`, and its live list/non-follow tests stay green; `v2/src/commands/pipeline.test.ts` test `prints one minified JSON snapshot with ordered stage projection` stays single-fetch.
- [x] The exact-output `pipeline list` regression in `v2/src/commands/pipeline.test.ts` pins all added fields and their omitted-versus-`null` JSON serialization.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — extend the `pipeline_list` IPC snapshot contract with field placement and omitted-versus-`null` semantics.
- `v2/docs/write-behavior.md` — extend the `jarvis pipeline list` JSON output contract with field placement and omitted-versus-`null` semantics.
- `v2/docs/operator-runbook.md` — extend the point-in-time pipeline snapshot field list, including durable admission `seedPath` semantics.
- `v2/docs/v1-behaviors.md` — record the additive v2 observation fields.
