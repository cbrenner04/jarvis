# Migrate pipeline-execution microtask spins

## Problem

`pipeline-execution.test.ts` has five unbounded microtask spins: `stage0WaitCalled`, `stage1WaitCalled` ×2, `failedStageWaitCalled`, and the `implement` stage status poll (~4210). Fixed double-yields for race coordination (~1102–1103) are out of scope.

## Surface

`v2/src/daemon/pipeline-execution.test.ts`.

## Decisions

- Replace every unbounded `while` loop (or condition poll) yielding only via `await Promise.resolve()` with `spinUntilMicrotask`; rules out touching deadline-bound polls such as `Date.now() < deadline` loops that use `setImmediate` or `setTimeout` and rules out rewriting fixed double-yields.
- Preserve every existing assertion; rules out dispatch-timing or production changes.

## Task checklist

- Import `spinUntilMicrotask` from `v2/src/testing/bounded-microtask-spin.ts`.
- Replace the five unbounded microtask spins (`stage0WaitCalled`, `stage1WaitCalled` ×2, `failedStageWaitCalled`, `implement` status poll) with bounded helper calls and descriptive labels.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [ ] `pipeline-execution.test.ts` contains zero unbounded `while` loops (or condition polls) yielding only via `await Promise.resolve()` (reachable on main today via `stage0WaitCalled`, `stage1WaitCalled` ×2, `failedStageWaitCalled`, and the `implement` status poll).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
