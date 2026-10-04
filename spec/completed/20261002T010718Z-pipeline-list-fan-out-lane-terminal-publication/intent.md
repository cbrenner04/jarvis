---
name: pipeline-list-fan-out-lane-terminal-publication
---

# Pipeline list exposes fan-out lane terminal publication on stage rows

## Problem

Operators cannot see per-lane terminal publication on `pipeline list` stage rows for fan-out pipelines, and single-lane list payloads must not change shape.

## Decisions

- Fan-out suffix `pipeline_list` stage rows surface per-lane terminal publication inside the existing `artifact` object as `terminalPublication` (no new top-level stage-row keys).
- Single-lane pipeline snapshots and derived-state projection stay byte-for-byte identical to today's `pipeline_list` encoding.

## Acceptance criteria

- [ ] `daemon-pipeline-handlers.test.ts` or focused list coverage: a settled two-lane fan-out snapshot exposes each lane implement row's `artifact.terminalPublication` on `pipeline_list`; fails against pre-fix artifacts without that nested field.
- [ ] Same surface plus existing single-lane list tests: a representative single-lane `pipeline_list` response matches a checked-in byte-equality fixture from main; fails if fan-out work alters single-lane JSON shape.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — configured-pipeline fan-out settlement visible on `pipeline list`.
- `v2/docs/v1-behaviors.md` — `pipeline_list` fan-out stage `artifact.terminalPublication` projection.

## Prerequisites

- Per-lane terminal publication outcome is durable on each fan-out lane's final workflow stage artifact as `terminalPublication` success or failure.
- Pipeline `terminalPublicationSucceededAt` is set only when every lane's publication succeeded; pipeline `terminalPublicationFailure` names the failing lane(s).
- Fan-out pipelines derive `succeeded` only when every lane's publication succeeded; a lane publication failure derives `failed` naming that lane.
- Fan-out pipelines run terminal publication once per settled lane against that lane's last succeeded workflow artifact without the multi-branch refusal.
