# Migrate pipeline-execution resolveStage plan builder cast

## Problem

`pipeline-execution.test.ts` `resolveStage` `plan` builder (~5782) returns a partial write-step literal cast with `as unknown as AnyWorkflowStep[]`. It is not covered by dispatch-stub or stale-reset migrations.

## Surface

`v2/src/daemon/pipeline-execution.test.ts`.

## Decisions

- Remove the `plan` builder inline cast via a type-complete write-step literal or `createWriteStep` (+ `managedWorktree` overrides); rules out routing through `createMinimalDispatchWriteStep`.
- Preserve every existing assertion; rules out dispatch-timing or production changes.

## Task checklist

- Retype the `plan` builder `steps` array (~5782) without `as unknown as AnyWorkflowStep[]`, preserving `managedWorktree`, `specPath`, and identity fields.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [ ] `pipeline-execution.test.ts` contains zero `as unknown as AnyWorkflowStep` casts (reachable on main today across `taggedStep`, inline literals, array casts, and the `plan` builder).
- [x] `pipeline-execution.test.ts` contains zero unbounded `while` loops (or condition polls) yielding only via `await Promise.resolve()` (reachable on main today via `stage0WaitCalled`, `stage1WaitCalled` ×2, `failedStageWaitCalled`, and the `implement` status poll).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
