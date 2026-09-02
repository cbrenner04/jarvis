# Migrate pipeline-stage-recovery tests

## Problem

`pipeline-stage-recovery.test.ts` repeats `WRITE_STEP` and inline `{ behavior: "write", stepId: ... } as unknown as AnyWorkflowStep` literals across fan-out and recovery scenarios.

## Surface

`v2/src/daemon/pipeline-stage-recovery.test.ts`.

## Decisions

- Replace `WRITE_STEP` and inline write-step casts with `createMinimalDispatchWriteStep` (override `stepId` / `branchKey` as today); rules out retaining `WRITE_STEP` or new per-file partial stubs.
- This file has no unbounded microtask spins; rules out introducing spin-helper edits here.
- Preserve every existing assertion; rules out production recovery changes.

## Task checklist

- Import `createMinimalDispatchWriteStep` from `v2/src/testing/workflow-step-fixtures.ts`.
- Retire `WRITE_STEP` and migrate every inline write-step cast site.
- Leave `planReviewStep` call sites that already return typed review steps unchanged unless they still carry casts.

## Acceptance criteria

- [ ] `pipeline-stage-recovery.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [ ] `pipeline-stage-recovery.test.ts` contains zero `as unknown as AnyWorkflowStep` casts (reachable on main today via `WRITE_STEP` and inline write-step literals).
- [ ] `bun run test:v2` passes; no test cases removed from the four migrated daemon files (`pipeline-execution.test.ts`, `pipeline-stage-dispatch.test.ts`, `daemon-pipeline-recover.test.ts`, `pipeline-stage-recovery.test.ts`).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
