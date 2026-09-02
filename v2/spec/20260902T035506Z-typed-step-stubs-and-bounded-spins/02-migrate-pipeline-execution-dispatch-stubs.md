# Migrate pipeline-execution dispatch stubs

## Problem

`pipeline-execution.test.ts` dispatch-only cast sites: `STUB_STEP_WORKTREE`, `taggedStep`, `fanOutTaggedStep`, and inline write-step literals in `resolveStage` handlers (~2983, ~3662, ~3914, ~5409, ~5462). `stageIndexOf` reads `stageIndex` via a separate ad-hoc cast.

## Surface

`v2/src/daemon/pipeline-execution.test.ts`.

## Decisions

- Retire `STUB_STEP_WORKTREE`, `taggedStep`, and `fanOutTaggedStep`; replace with `createMinimalDispatchWriteStep` overrides (pass `stageIndex`, `branchKey`, and `worktree` as today); rules out new per-file partial stubs and rules out routing binding-heavy stale-reset steps through the minimal factory.
- Update `stageIndexOf` to read `stageIndex` from the factory return type without ad-hoc casts; rules out reintroducing `(steps[0] as unknown as { stageIndex: number })`.
- Preserve every existing assertion; rules out dispatch-timing or production changes.

## Task checklist

- Import `createMinimalDispatchWriteStep` from `v2/src/testing/workflow-step-fixtures.ts`.
- Migrate `taggedStep` / `fanOutTaggedStep` call sites and inline dispatch write-step literals (~2983, ~3662, ~3914, ~5409, ~5462) to the minimal factory.
- Retire `STUB_STEP_WORKTREE`; update `stageIndexOf` to use the typed `stageIndex` field.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [x] `pipeline-execution.test.ts` contains zero `as unknown as AnyWorkflowStep` casts reachable on main today via `taggedStep`, `fanOutTaggedStep`, and inline dispatch write-step literals (~2983, ~3662, ~3914, ~5409, ~5462).
- [x] `stageIndexOf` contains no ad-hoc cast to read `stageIndex` (reachable on main today via `(steps[0] as unknown as { stageIndex: number })`).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
