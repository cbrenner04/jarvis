---
name: pipeline-list-detail-fields
---

# Pipeline list detail fields

Expose the durable pipeline and stage diagnostics required by observation clients on the existing `pipeline_list` snapshot.

## Problem

`projectPipelineSnapshot` drops terminal publication, admission seed-path, and stage diagnostic fields already held by the durable records.

## Decisions

- Project pipeline `terminalAction`, admission `seedPath`, `terminalPublicationSucceededAt`, and `terminalPublicationFailure` additively — rules out a second detail RPC or TUI access to persistence.
- Project stage record `id`, authored `position`, `artifact`, and `failureDetail`, preserving nullable JSON values — rules out reconstructing durable diagnostics in clients.
- Preserve snapshot ordering, derived state, timing, and parameterless one-shot semantics — rules out a persistence migration or `pipeline_list` redesign.
- Keep detail-pane rendering out of this change — rules out coupling daemon projection review to TUI presentation.

## Acceptance criteria

- [ ] `pipeline_list` returns pipeline terminal action, admission seed path, and terminal publication success or failure from a stored pipeline record.
- [ ] `pipeline_list` returns each stored stage record's id, position, artifact, and failure detail without changing stage order.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` pins the new fields with regression expectations that fail against the baseline projection.
- [ ] Each mutation-checkpoint criterion names a pinning test carrying a matching `// @mutate <path> "<old>" -> "<new>"` directive.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — extend the `pipeline_list` IPC contract.
- `v2/docs/write-behavior.md` — extend the `jarvis pipeline list` output contract.
- `v2/docs/operator-runbook.md` — extend the point-in-time pipeline snapshot field list.
- `v2/docs/v1-behaviors.md` — record the additive v2 observation fields.

## Prerequisites

- Durable admitted pipeline records retain terminal action, admission seed path, terminal publication success time, and terminal publication failure.
- Durable pipeline stage records retain id, authored position, artifact, and failure detail.
- `pipeline_list` returns ordered durable pipeline snapshots without following live transitions.
