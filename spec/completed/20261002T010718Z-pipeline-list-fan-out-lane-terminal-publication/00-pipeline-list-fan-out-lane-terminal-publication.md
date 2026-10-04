# Project fan-out lane terminal publication on pipeline_list stage artifacts

## Problem

Durable per-lane `artifact.terminalPublication` stamps exist on fan-out suffix workflow stages after terminal publication settlement, but `pipeline_list` stage rows do not expose that nested field to operators. Single-lane snapshots must stay byte-for-byte identical to today's encoding.

## Decisions

- Fan-out suffix `pipeline_list` `stages[]` rows carry per-lane terminal publication only inside the existing `artifact` object as `terminalPublication` — rules out new top-level stage-row keys or moving lane stamps to pipeline-level fields only.
- Only non-`default` fan-out branch rows for each lane's final succeeded workflow stage project `terminalPublication` when the durable stage artifact carries it — rules out stamping prefix `default` rows or non-terminal workflow stages.
- Single-lane pipelines (`branchKey: "default"` throughout) keep today's `projectPipelineSnapshot` / `derivePipelineState` wire JSON byte-for-byte for a representative admitted fixture — rules out adding `terminalPublication` to default-lane artifacts or changing stage order, omission semantics, or pipeline-level terminal fields.
- List projection is read-only over durable stage rows (`projectObservedPipelineStage` / `projectPipelineSnapshot`); no terminal publication execution in the list handler — rules out recomputing stamps from pipeline columns during `pipeline_list`.
- Single-lane preservation is pinned by a checked-in byte fixture captured from `main` before this change (one minified `JSON.stringify` pipeline entry from `pipeline_list`), not hand-authored JSON — rules out fixtures that drift from real handler encoding.

## Tasks

- [x] No production change: `projectPipelineSnapshot` already passes stage artifacts through, so lane stamps from #4413 surface on `pipeline_list` (verified in review); this subspec pins that behavior.
- [x] Add `v2/src/daemon/daemon-pipeline-observation.test.ts` coverage: two-lane fan-out fixture with per-lane `commitTerminalPublicationSuccess` / failure stamps on final workflow stage artifacts, assert `handlers().pipeline_list` exposes each lane implement row's `artifact.terminalPublication`; reuse `admitFanOutObservationPipeline` / `FAN_OUT_OBS_*` patterns where they fit.
- [x] Add checked-in fixture under `v2/src/daemon/fixtures/` (or adjacent test fixture path matching repo convention) plus a test that `JSON.stringify` of one representative single-lane `pipeline_list` pipeline snapshot matches the fixture bytes exactly.
- [x] Update documentation listed under Documentation updates.

## Acceptance criteria

- [x] `daemon-pipeline-observation.test.ts` — new test `pipeline_list exposes per-lane artifact.terminalPublication on settled two-lane fan-out implement rows`: after durable per-lane terminal publication stamps on both lanes' final workflow stage artifacts, `pipeline_list` returns each lane's implement row with matching `artifact.terminalPublication`; regression pin (passes on main, which already projects the stamps).
- [x] Same test file — new test `pipeline_list single-lane snapshot matches main byte fixture`: representative single-lane admitted pipeline `pipeline_list` entry matches the checked-in fixture bytes; fails if fan-out projection work alters default-lane artifact keys, stage order, or pipeline-level terminal fields on that fixture.
- [x] `daemon-pipeline-observation.test.ts` — `projectPipelineSnapshot projects stored terminal and admission diagnostics with JSON omission semantics` stays green.
- [x] `daemon-pipeline-handlers.test.ts` — `pipeline_list projects admitted pipelines with derived state` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — note that configured fan-out terminal settlement is visible per lane on `pipeline list --json` via each suffix implement row's `artifact.terminalPublication`.
- `v2/docs/v1-behaviors.md` — record `pipeline_list` fan-out stage `artifact.terminalPublication` projection for suffix lanes.
