---
name: run-stage-terminal-finish
---

# Durable terminal finish timestamps for runs and stages

Carved from `durable-terminal-timestamps` (the plan over-decomposed the combined intent and mis-built its index twice). This is the run/stage-finish half; approval `decidedAt` is the sibling `approval-decided-at`. The daemon-wire projection stays in `terminal-timestamps-on-daemon-wire`.

## Problem

Terminal rows can be persisted with no finish time. `setRunStatus(runId, "failed")` and `commitGuardedKill` write a terminal run status and nothing else — only `commitCompletionBoundary` stamps attempt `completed_at` — so a run failed at the spawn boundary has no durable finish timestamp. `updateStage` accepts a terminal `status` with no `endedAt` and persists it; `skipRemainingStages` (`v2/src/daemon/pipeline-execution.ts`) does exactly that with `patch: { status: "skipped" }`.

## Decisions

- The run finish timestamp is stamped at the durable terminal transition, not derived at read time — rules out a projection inventing one from `createdAt` or the clock.
- The stage-terminal `endedAt` invariant is enforced where the stage row is written, so a caller that omits it cannot persist a finishless terminal row — rules out a caller-side audit alone.
- `skipped` counts as terminal for that invariant — rules out leaving blocked-suffix rows finishless.
- `startedAt` stays null on a stage that failed before start; no start time is invented.
- Store schema changes are forward-only appended migrations.

## Acceptance criteria

- [ ] A run driven to terminal via `setRunStatus` alone (spawn-boundary failure-capture shape, no attempt, no `reconciledAt`) carries a durable run finish timestamp; a `state-store.test.ts` test naming that shape fails against pre-fix code.
- [ ] `commitGuardedKill` leaves the killed row with a durable finish timestamp.
- [ ] A terminal stage status persisted with no `endedAt` is not constructible; the `patch: { status: "skipped" }` write `skipRemainingStages` issues lands `endedAt`, and a `state-store.test.ts` test pinning it fails against pre-fix code.
- [ ] Mutation checkpoint: in `state-store.test.ts` test `terminal stage status without endedAt still persists an end timestamp`, a `// @mutate` neutering the terminal-status stamp turns that regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema/API/Semantics — the run finish column; terminal run and terminal stage writes always record a finish time; `startedAt` stays null on failed-before-start.
- `v2/docs/v1-behaviors.md` — `setRunStatus`, `commitGuardedKill`, terminal `updateStage`/`skipRemainingStages` writes now always carry a finish timestamp.
