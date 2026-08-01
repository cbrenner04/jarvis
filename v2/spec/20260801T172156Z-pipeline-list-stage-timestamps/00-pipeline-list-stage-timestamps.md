# Pipeline list stage timestamps

Project durable stage `startedAt` and `endedAt` through `projectPipelineSnapshot` so `pipeline_list`
and `jarvis pipeline list` expose honest per-stage timing without deriving from run rows.

## Problem

Stage timing exists on `PipelineStageRecord` but `projectPipelineSnapshot` drops it. Operators and
the TUI cannot read stage elapsed from the observation wire.

## Decisions

- Stage rows on `PipelineSnapshot` / `pipeline_list` add `startedAt` and `endedAt` (`number | null`,
  milliseconds since epoch) copied from the durable stage record — rules out deriving stage elapsed
  from run rows or pipeline finish derivation.
- Unset durable timestamps project as explicit `null` — rules out omitting the fields from the wire shape.
- Out of scope: elapsed formatting, TUI rendering, local tick, and `list` run start projection — sibling CLI intent.

## Tasks

- Extend `PipelineSnapshot` stage row type and `projectPipelineSnapshot` in `pipeline-observation.ts`.
- Add `projectPipelineSnapshot includes stage startedAt and endedAt from durable records` in
  `daemon-pipeline-observation.test.ts` — fixture covers set timestamps, explicit `null` when unset,
  and a running stage with `startedAt` set and `endedAt` null.
- Add separate `Mutation checkpoint:` comments on that pin for omitting `startedAt` and omitting
  `endedAt` from stage projection.
- Extend strict `toEqual` stage-row expectations in `pipeline_list reports every admitted pipeline with
  identity, derived state, and ordered stage projection` and `two-branch pipeline_list projection
  includes branchKey per durable row`.
- Update `v2/docs/daemon-host.md`, `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and
  `v2/docs/v1-behaviors.md` for the stage row field list.

## Acceptance criteria

- [ ] `daemon-pipeline-observation.test.ts` — `projectPipelineSnapshot includes stage startedAt and endedAt from durable records` fails against the pre-fix projection and passes after implementation; pin asserts set values, explicit `null` when unset, and a running stage with `startedAt` set and `endedAt` null.
- [ ] `daemon-pipeline-observation.test.ts` — omitting `startedAt` from stage projection turns `projectPipelineSnapshot includes stage startedAt and endedAt from durable records` RED; `Mutation checkpoint:` on that pin names `startedAt` omission.
- [ ] `daemon-pipeline-observation.test.ts` — omitting `endedAt` from stage projection turns `projectPipelineSnapshot includes stage startedAt and endedAt from durable records` RED; `Mutation checkpoint:` on that pin names `endedAt` omission.
- [ ] `daemon-pipeline-observation.test.ts` — `"pipeline_list returns an empty pipelines array for an empty store"` stays green.
- [ ] `daemon-pipeline-observation.test.ts` — `pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection` and `two-branch pipeline_list projection includes branchKey per durable row` include per-row `startedAt` and `endedAt` in strict stage `toEqual` expectations.
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
