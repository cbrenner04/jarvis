# Pipeline list snapshot and wait

## Problem

Operators cannot snapshot or block on daemon-owned pipeline progress from the CLI.

## Prerequisites

- [00](./00-pipeline-start-and-attach-detach.md) registers `jarvis pipeline` and `pipeline start`.
- `pipeline_list` returns durable pipeline snapshots with ordered stages (`v2/src/daemon/daemon-pipeline-observation.test.ts`).
- `pipeline_wait` distinguishes terminal and `awaiting-approval` boundaries (`v2/src/daemon/pipeline-observation.ts`, `daemon-pipeline-observation.test.ts`).
- `StateStore.listPipelines` enumerates admitted pipelines with ordered stage rows (`v2/src/persistence/state-store.test.ts`).

## Decisions

- Add `jarvis pipeline list` and `jarvis pipeline wait <pipeline-id>` alongside `start` under the same `jarvis pipeline` family; rules out cross-referencing `jarvis run list` for stage progress.
- `pipeline list` issues one `pipeline_list` RPC, prints every pipeline row and nested ordered stage rows exposing stage ID, status, and workflow invocation ID, then exits; rules out run-list lookup, implicit follow, or holding the shell until pipelines finish.
- `pipeline list` on a live non-terminal pipeline completes within a bounded test window while reporting a non-terminal derived state; rules out default observation following live work.
- `pipeline wait <pipeline-id>` issues one blocking `pipeline_wait` and prints one minified JSON line naming the boundary (`{kind:"terminal",state}` or `{kind:"awaiting-approval",stageId}`); rules out an unnamed intermediate success.
- `pipeline wait` exits `0` on `awaiting-approval` and on terminal `succeeded`, non-zero on other terminal states; rules out treating failed/rejected/interrupted waits as success.
- Missing/empty pipeline ID is a usage error before daemon connect; unknown durable ID surfaces daemon `unknown_pipeline` on stderr with non-zero exit; rules out beginning a wait on a bad ID.
- CLI-only; no daemon snapshot or wait behavior changes.

## Task checklist

- Implement `pipeline list` and `pipeline wait` in `v2/src/commands/pipeline.ts` with usage/help entries.
- Extend `v2/src/commands/pipeline.test.ts` with list projection, live bounded snapshot, wait boundary, help, and guard-inversion coverage.
- Complete pipeline command documentation in `v2/docs/write-behavior.md` and operator list/wait workflows in `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [ ] The list/wait regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then reports ordered stage ID, status, and workflow invocation ID plus distinct terminal and `awaiting-approval` wait boundaries.
- [ ] The live-list regression in `v2/src/commands/pipeline.test.ts` fails on baseline and returns within its bound while a pipeline remains non-terminal.
- [ ] Inverting the list non-follow guard or the wait-boundary guard makes `v2/src/commands/pipeline.test.ts` fail; negative cases prove list does not follow live transitions and wait does not resolve on `pending`/`running` alone.
- [ ] The help regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then exposes the `jarvis pipeline` family, `start` operands, detach behavior, list snapshot semantics, and wait boundaries.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline list` snapshot output and bounded semantics; `jarvis pipeline wait` syntax, boundary JSON, exit codes, and errors; completes the pipeline command table started in [00](./00-pipeline-start-and-attach-detach.md).
- `v2/docs/operator-runbook.md` — list snapshot vs `pipeline wait`, and when to detach `start` then `wait`/`list`.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only pipeline observation CLI.
