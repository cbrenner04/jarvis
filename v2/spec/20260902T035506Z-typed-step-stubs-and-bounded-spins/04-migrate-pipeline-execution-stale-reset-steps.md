# Migrate pipeline-execution stale-reset step arrays

## Problem

`pipeline-execution.test.ts` stale-reset helpers `intentSteps`, `planSteps`, and `implementSteps` cast full step arrays with `as unknown as AnyWorkflowStep[]`. These steps carry `landing`, `publishCompletion`, `managedWorktree`, and a `review-debate` step whose `agents` shape must satisfy `ReviewDebateWorkflowStep` (per-role map, not `["claude"]`); the implement write step omits `expectedArtifactPath`.

## Surface

`v2/src/daemon/pipeline-execution.test.ts`.

## Decisions

- Remove `intentSteps`, `planSteps`, and `implementSteps` array casts via type-complete literals or `createWriteStep` (+ overrides where `managedWorktree` / bindings already exist); rules out routing stale-reset / binding-heavy steps through `createMinimalDispatchWriteStep`.
- Preserve every existing assertion; rules out dispatch-timing or production changes.

## Task checklist

- Migrate `intentSteps`, `planSteps`, and `implementSteps` array literals off `as unknown as AnyWorkflowStep[]` casts, preserving each step's landing, worktree, `publishCompletion`, and `review-debate` `agents` shape.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [ ] `intentSteps`, `planSteps`, and `implementSteps` contain zero `as unknown as AnyWorkflowStep[]` casts (reachable on main today via the stale-reset array helpers).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
