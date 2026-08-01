# Pipeline list stage timestamps

Project durable stage `startedAt` and `endedAt` through `projectPipelineSnapshot` so `pipeline_list`
and `jarvis pipeline list` expose honest per-stage timing without deriving from run rows.

## Problem

Stage timing exists on `PipelineStageRecord` but `projectPipelineSnapshot` drops it. Operators and
the TUI cannot read stage elapsed from the observation wire.

## Decisions

- Stage rows on `PipelineSnapshot` / `pipeline_list` add `startedAt` and `endedAt` (`number | null`) copied from the durable stage record — rules out deriving stage elapsed from run rows or pipeline finish derivation.
- Unset durable timestamps project as explicit `null` — rules out omitting the fields from the wire shape.
- Out of scope: elapsed formatting, TUI rendering, local tick, and `list` run start projection — sibling CLI intent.

## Tasks

- Extend `PipelineSnapshot` stage row type and `projectPipelineSnapshot` in `pipeline-observation.ts`.
- Pin projection in `daemon-pipeline-observation.test.ts` for set timestamps, unset (`null`), and
  `pipeline_list` end-to-end when stages carry lifecycle times.
- Add `Mutation checkpoint:` on the stage timestamp pin naming omission of `startedAt` or `endedAt`
  from stage projection.
- Update `v2/docs/daemon-host.md`, `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and
  `v2/docs/v1-behaviors.md` for the stage row field list.

## Acceptance criteria

- [ ] `daemon-pipeline-observation.test.ts` — `projectPipelineSnapshot` emits each stage's `startedAt` and `endedAt` from the durable record (`null` when unset); fails against the pre-fix projection.
- [ ] `daemon-pipeline-observation.test.ts` — omitting `startedAt` or `endedAt` from stage projection turns the stage timestamp pin RED; `Mutation checkpoint:` on that pin names that omission.
- [ ] `daemon-pipeline-observation.test.ts` — `"pipeline_list returns an empty pipelines array for an empty store"` stays green.
- [ ] `v2/docs/daemon-host.md` — `pipeline_list` stage rows include `startedAt` and `endedAt`.
- [ ] `v2/docs/write-behavior.md` — `jarvis pipeline list` stage field list includes `startedAt` and `endedAt`.
- [ ] `v2/docs/operator-runbook.md` — `jarvis pipeline list` stage field list includes `startedAt` and `endedAt`.
- [ ] `v2/docs/v1-behaviors.md` — `pipeline_list` stage row shape includes `startedAt` and `endedAt`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_list` stage rows include `startedAt` and `endedAt`.
- `v2/docs/write-behavior.md` — `jarvis pipeline list` stage field list includes `startedAt` and `endedAt`.
- `v2/docs/operator-runbook.md` — `jarvis pipeline list` stage field list includes `startedAt` and `endedAt`.
- `v2/docs/v1-behaviors.md` — `pipeline_list` stage row shape includes `startedAt` and `endedAt`.
