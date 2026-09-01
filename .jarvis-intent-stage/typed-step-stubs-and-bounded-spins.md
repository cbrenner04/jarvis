---
name: typed-step-stubs-and-bounded-spins
---

# Daemon test scaffolding: typed step stubs and bounded microtask spins

Unsplit rationale: The typed step factory, bounded spin helper, daemon test migrations, and test-writing guidance are one daemon pipeline test-scaffolding contract; no persistence, CLI, or execution-loop production boundary changes.

## Primary implementation surface

Shared daemon pipeline test fixtures in `v2/src/testing/`

## Problem

- Type-lying `{ behavior: "write", … } as unknown as AnyWorkflowStep` stubs in `v2/src/daemon/*.test.ts` bypass the compiler, so production additions such as `step.worktree.projectName` in the shared stamp surface as runtime throws instead of fixture compile errors (#3060).
- Bare `while (!flag) await Promise.resolve()` spins in daemon pipeline tests starve the event loop when a pre-`wait()` failure leaves the flag unset, so per-test timeouts never fire and the file hangs with zero diagnosable output (#3060).

## Behavior

- Add one shared type-complete minimal pipeline step factory in `v2/src/testing/` and migrate every `as unknown as AnyWorkflowStep` cast in `v2/src/daemon/*.test.ts` to it, retiring per-file partial stubs such as `STUB_STEP_WORKTREE`.
- Add a bounded microtask-spin helper in `v2/src/testing/` and replace every bare `while (!flag) await Promise.resolve()` spin in `v2/src/daemon/*.test.ts` with it so an unreached flag throws a named error instead of hanging the file.
- Preserve every existing assertion and leave production dispatch timing unchanged.

## Decision ledger

- One shared type-complete minimal step factory in `v2/src/testing/` replaces `as unknown as AnyWorkflowStep` casts; rules out each test file inventing partial stubs.
- A bounded spin helper (cap plus throw naming the unreached flag) replaces bare microtask spins in daemon tests; rules out the silent-starvation class.
- Behavior-preserving: no assertion dropped and production fast-path shape unchanged; rules out scope creep into dispatch timing.
- Deferred to first consumer: default spin iteration cap — pin when a caller needs it.

## Prerequisites

## Acceptance criteria

- [ ] No `as unknown as AnyWorkflowStep` cast remains in `v2/src/daemon/*.test.ts`; the shared factory is the only stub source, pinned by grep-level absence.
- [ ] A test in `v2/src/testing/` proves a spin whose flag never sets fails with the helper's named error instead of hanging; it fails against the pre-fix bare microtask spin.
- [ ] `pipeline-execution.test.ts`, `pipeline-stage-dispatch.test.ts`, `daemon-pipeline-recover.test.ts`, and `pipeline-stage-recovery.test.ts` stay green (behavior unchanged by the scaffolding extraction).
- [ ] `bun run typecheck` and `bun run test:v2` pass with unchanged test counts.

## Documentation updates

- `v2/docs/test-writing.md` — document the step-stub factory and bounded-spin rule, with the #3060 hang as the cautionary case.
