---
name: typed-step-stubs-and-bounded-spins
---

# Daemon test scaffolding: typed step stubs, bounded microtask spins

## Problem

The #3060 wedge needed two test-scaffolding hazards to become a silent file-wide hang, and both remain in the tree:

- **Type-lying step stubs.** `{ behavior: "write", … } as unknown as AnyWorkflowStep` bypasses the type system, so when production grew a required dereference (`step.worktree.projectName` in the shared stamp), the compiler could not flag the fixture gap — the stamp threw at runtime instead. Fixed by hand in `pipeline-execution.test.ts` (`STUB_STEP_WORKTREE`), but sibling casts remain: `daemon-pipeline-recover.test.ts:140`, `pipeline-stage-dispatch.test.ts:30`, `pipeline-stage-recovery.test.ts:112,166,830`.
- **Unbounded microtask spins.** `while (!flag) await Promise.resolve()` drains only microtasks; any pre-`wait()` failure leaves the flag unset and the spin starves the event loop — per-test timeouts never fire, the file hangs with zero output, and the failure is undiagnosable from the outside (#3060's implementing agent bisected to a wrong root cause). The idiom also pressures production to avoid macrotask hops for test speed (`pipeline-execution.ts` fast-path comment), coupling production shape to test brittleness.

## Decisions

- One shared, type-complete minimal step factory in `v2/src/testing/` replaces the `as unknown as AnyWorkflowStep` casts; a compile error, not a runtime throw, is the signal when production adds a required step field. Rules out each test file inventing partial stubs.
- A bounded spin helper (cap + throw naming the unreached flag) replaces bare microtask spins in daemon tests, so a pre-`wait()` failure becomes a named test failure instead of a file hang. Rules out the silent-starvation class.
- Behavior-preserving: no assertion dropped; the production fast-path shape is not changed by this seed. Rules out scope creep into dispatch timing.

## Acceptance criteria

- [ ] No `as unknown as AnyWorkflowStep` cast remains in `v2/src/daemon/*.test.ts`; the shared factory is the only stub source, pinned by grep-level absence.
- [ ] A test whose spin flag never sets fails with the helper's named error instead of hanging, pinned by a helper self-test.
- [ ] `bun run typecheck` and `bun run test:v2` pass with unchanged test counts.

## Documentation updates

- `v2/docs/test-writing.md` — the step-stub factory and the bounded-spin rule, with the #3060 hang as the cautionary case.
