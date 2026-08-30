---
name: pipeline-implement-stage-honors-review-posture
---

# `fast` pipeline implement stages run debate review instead of the configured `review: "light"`

## Problem

A `fast` pipeline's implement stage is defined `review: "light"` (`v2/src/execution/pipeline-registry.ts`), and the stage resolver sets it correctly — `pipeline-stage-resolve.ts:349-350` emits `reviewPasses: 1` and `reviewBehavior: "light"` on the resolved stage config. But the dispatched implement runs a full **debate** (adversary/advocate/adjudicator/actuator), so `reviewBehavior` is dropped **between stage resolution and the workflow run** — the implement falls back to its debate default. Every `fast` implement then pays ~4 review roles instead of 1 critic: a silent cost/time/posture regression.

Suspected cause: this session's front-door dispatch-parity work (`share-workflow-start-preparation` #3143 / `dispatch-pipeline-stages-through-shared-preparation` #3170) routes pipeline stage dispatch through the shared `prepareWorkflowStart`, and that path does not thread the resolved stage's `reviewBehavior`/`reviewPasses` into the dispatched workflow snapshot. Ironically the same "assembled twice, one copy stale" class the front-door work set out to retire — confirm the exact drop point at fix time.

## Evidence (2026-08-30)

`~/.jarvis/telemetry.jsonl`, project `chess-mvp-yolo`, `fast` pipeline `9575a0a6` (definition confirmed `fast` via `pipeline list --json`):

- Implements through 2026-08-29 recorded review roles `{critic, actuator}` (light) — correct.
- Implements on 2026-08-30 (lanes `board-settings-userdefaults-persistence`, `in-progress-game-swiftdata-persistence`, `game-result-and-win-rate-store`) recorded `{adversary, advocate, adjudicator, actuator}` (debate).

Light → debate flip coincides with the front-door dispatch landings, with no change to the `fast` definition.

## Decisions

- A dispatched pipeline stage must honor its resolved `reviewBehavior`/`reviewPasses`; the shared `prepareWorkflowStart` front door must carry them into the workflow snapshot rather than letting the implement workflow apply its standalone debate default. Rules out re-deriving review posture at dispatch.
- Scope: pipeline stage dispatch through the shared preparation path; both `light` and `none` postures must survive (a `review: "none"` stage must not gain a review either). No change to the registry definitions or standalone `jarvis run workflow implement` defaults.

## Acceptance criteria

- [ ] A daemon/dispatch test proves a `fast` implement stage's dispatched workflow snapshot carries `reviewBehavior: "light"` and `reviewPasses: 1` end-to-end through `prepareWorkflowStart`, and that its review invocation takes the single-critic light path, not the debate chain; it fails against the pre-fix drop that runs debate.
- [ ] A test proves a `review: "none"` stage dispatches with no review roles (reviewPasses 0) — the drop does not silently add one either.
- [ ] A `full-review` implement stage still dispatches debate (no regression to the debate posture).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` / `workflow-runner.md` — pipeline stage dispatch honors the resolved review posture (`none`/`light`/`debate`) through the shared preparation front door.
