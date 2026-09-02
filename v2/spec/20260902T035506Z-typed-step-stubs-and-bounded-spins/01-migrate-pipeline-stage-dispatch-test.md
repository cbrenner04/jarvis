# Migrate pipeline-stage-dispatch tests

## Problem

`pipeline-stage-dispatch.test.ts` uses `okStep` (`{ behavior: "write" } as unknown as AnyWorkflowStep`) and a bare `while (!waitCalled) { await Promise.resolve(); }` spin (#3060).

## Surface

`v2/src/daemon/pipeline-stage-dispatch.test.ts`.

## Decisions

- Replace `okStep` with `createMinimalDispatchWriteStep()`; rules out retaining the per-file `okStep` partial stub.
- Replace the `waitCalled` microtask spin with `spinUntilMicrotask`; rules out leaving an unbounded `Promise.resolve()` yield loop in this file.
- Preserve every existing assertion; rules out dispatch-timing or production changes.

## Task checklist

- Import helpers from `v2/src/testing/`.
- Retire `okStep`; use the minimal factory at every former `okStep` site.
- Replace the `waitCalled` spin with the bounded helper, passing a label that identifies the waited condition.

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [ ] `pipeline-stage-dispatch.test.ts` contains zero `as unknown as AnyWorkflowStep` casts (reachable on main today via `okStep`).
- [ ] `pipeline-stage-dispatch.test.ts` contains zero unbounded `while` loops (or condition polls) yielding only via `await Promise.resolve()` (reachable on main today via the `waitCalled` loop).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
