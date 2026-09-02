---
name: typed-step-stubs-and-bounded-spins
---

# Daemon test scaffolding: typed step stubs and bounded microtask spins

Unsplit rationale: The typed step factory, bounded spin helper, daemon test migrations, and test-writing guidance are one daemon pipeline test-scaffolding contract; no persistence, CLI, or execution-loop production boundary changes.

## Primary implementation surface

Shared daemon pipeline test fixtures in `v2/src/testing/`

## Problem

- Type-lying `{ behavior: "write", … } as unknown as AnyWorkflowStep` stubs in `v2/src/daemon/*.test.ts` bypass the compiler, so production additions such as `step.worktree.projectName` in the shared stamp surface as runtime throws instead of fixture compile errors (#3060).
- Bare unbounded microtask spins in daemon pipeline tests — `while (!flag) await Promise.resolve()` and condition polls that yield only via `await Promise.resolve()` with no deadline — starve the event loop when a pre-`wait()` failure leaves the condition unset, so per-test timeouts never fire and the file hangs with zero diagnosable output (#3060).

## Behavior

- Extend `v2/src/testing/workflow-step-fixtures.ts` with a type-complete minimal write-step factory for dispatch-only daemon pipeline tests and migrate every `as unknown as AnyWorkflowStep` cast in `v2/src/daemon/*.test.ts` to it or to existing `createWriteStep` where the test already needs binding/worktree fixtures; retire per-file partial stubs such as `STUB_STEP_WORKTREE`, `taggedStep`, and `okStep`.
- Add a bounded microtask-spin helper in `v2/src/testing/` and replace every bare unbounded microtask spin in `v2/src/daemon/*.test.ts` that yields only via `await Promise.resolve()` (including `while (!flag)` and condition polls such as `while (stages().find(...)?.status !== "succeeded")`) with it so an unreached condition throws a named error instead of hanging the file.
- Preserve every existing assertion and leave production dispatch timing unchanged.

## Decision ledger

- Extend `workflow-step-fixtures.ts` with a minimal type-complete write-step factory for dispatch-only stubs; keep `createWriteStep` for binding/worktree-heavy cases; rules out a parallel stub module or per-file partial stubs such as `STUB_STEP_WORKTREE` / `taggedStep` / `okStep`.
- Bounded microtask-spin helper (iteration cap plus throw naming the unreached condition) replaces all bare `await Promise.resolve()` yield loops in the four cast-bearing daemon test files, including the `stages().find(...)?.status` poll in `pipeline-execution.test.ts`; rules out leaving any unbounded microtask spin in that set and rules out rewriting deadline-bound `setImmediate` polls.
- Behavior-preserving: no assertion dropped and production fast-path shape unchanged; rules out scope creep into dispatch timing.
- Helper API ships with a concrete default iteration cap (plan picks the value); callers may override per site.

## Prerequisites

## Acceptance criteria

- [ ] No `as unknown as AnyWorkflowStep` cast remains in `v2/src/daemon/*.test.ts`; dispatch-only stubs come from the extended `workflow-step-fixtures.ts` minimal factory or existing `createWriteStep`, pinned by grep-level absence of the cast.
- [ ] `bounded-microtask-spin.test.ts` in `v2/src/testing/` proves a spin whose flag never sets fails with the helper's named error instead of hanging; it fails against the pre-fix bare microtask spin.
- [ ] `pipeline-execution.test.ts`, `pipeline-stage-dispatch.test.ts`, `daemon-pipeline-recover.test.ts`, and `pipeline-stage-recovery.test.ts` stay green (behavior unchanged by the scaffolding extraction).
- [ ] `bun run typecheck` and `bun run test:v2` pass with unchanged test counts.

## Documentation updates

- `v2/docs/test-writing.md` — document the minimal step factory alongside `createWriteStep`, the bounded microtask-spin helper (when to use it vs existing deadline-bound `setImmediate` polling), and the #3060 hang as the cautionary case for unbounded `Promise.resolve()` yields.
