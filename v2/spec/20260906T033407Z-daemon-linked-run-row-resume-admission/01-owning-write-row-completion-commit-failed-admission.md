# 01 - Owning write row completion_commit_failed admission

## Problem

A failed owning write row (including hidden `implement~shrink`) whose terminal `loop_finished` is `completion_commit_failed` with `resumable: true` projects `nextAction: "resume"`, but daemon `resume` can return `{ ok: true }` without `recordAttemptStart`, `iteration_started`, or publication-tail `loop_finished` honesty (#3462). The handler falls through to `reconstructWriteResume`/`spawnWriteLoop` instead of the ordinary-write finalization resolver family already used for exhausted-red and out-of-scope gate failures.

## Decisions

- Add `resolveCompletionCommitFailedResumeContext` beside `resolveExhaustedRedResumeContext` / `resolveWriteOutOfScopeResumeContext`, reusing `resolveOrdinaryWriteResumeContext` with an `completion_commit_failed` terminal admit predicate; rules out a third bespoke shrink suffix lookup (`resolveOrdinaryWriteResumeContext` today matches only exact snapshot ids).
- Snapshot step lookup inside the ordinary-write resolver family uses `findSnapshotStepForRunStepId`; rules out `implement~shrink` rows failing admission because the authored `implement` step is not an exact id match.
- Daemon `resume` admits owning write-row `completion_commit_failed` through `resumeFinalizationOnly` → `resumeReviewMutationFinalization` (publication-tail replay), checked ahead of `resumeContextForTerminalRecord`/`spawnWriteLoop`; rules out write-loop re-entry for a failure that already finished the write/shrink agent pass.
- Every admitted finalization replay records `recordAttemptStart`, appends `iteration_started`, and settles with an honest terminal `loop_finished` (success or named failure); rules out a silent `{ ok: true }` RPC that leaves durable state unchanged (#3462).
- Review-behavior rows and cross-row `surviving_mutation_failed` tails keep their existing resolver paths; this subspec covers only the owning write row id that recorded the `completion_commit_failed`.

## Task checklist

- [ ] Extend `resolveOrdinaryWriteResumeContext` (or its call sites) to resolve snapshot steps through `findSnapshotStepForRunStepId`.
- [ ] Export `resolveCompletionCommitFailedResumeContext` from `workflow-runner-resume.ts` with the same context shape as the other ordinary-write resolvers.
- [ ] In `daemon-run-lifecycle-handlers.ts`, gate `resumeHandler` on the new resolver (mirroring review-mutation / exhausted-red / out-of-scope ordering) and route matches through `resumeFinalizationOnly`.
- [ ] Add `daemon-resume.test.ts` coverage for a failed `implement~shrink` row with terminal `completion_commit_failed`: assert attempt + `iteration_started`, publication-tail replay without write-loop respawn, or a named refusal.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` proves `run resume` on a `completion_commit_failed` `implement~shrink` row records an attempt and replays publication through `resumeFinalizationOnly`, or refuses with a named reason; it fails against the current silent no-op (#3462).
- [ ] `v2/docs/v1-behaviors.md` records that owning write-row `completion_commit_failed` (including hidden `~shrink`) resumes through the ordinary-write finalization resolver and `resumeFinalizationOnly`, not write-loop respawn.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — owning write-row `completion_commit_failed` daemon admission path.
