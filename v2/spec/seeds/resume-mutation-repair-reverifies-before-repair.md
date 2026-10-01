---
name: resume-mutation-repair-reverifies-before-repair
---

# Resumed mutation repair re-verifies HEAD before repairing

## Problem

On resume, `replayMutationFinalization` (`v2/src/execution/workflow-runner-resume.ts` ~2789) rebuilds the survivor from the prior `loop_finished` via `survivingMutationErrorFromTerminalRecord` (~2635) and hands it to `runAutoDerivedSurvivingMutationRepair` (~2728), which enters repair without re-running diff-derived verification. When the operator already committed a killing test, repair works on an already-killed mutant and settles through `settleMutationRepairExhausted` (~2261) carrying the stale survivor.

## Evidence

- 2026-10-01: runs ff6cc773 (#4331) and 5280b7bf (#4332) settled `mutation_repair_exhausted` on survivors an operator commit had already killed; the hand-run verifier passed both at HEAD afterwards.

## Decisions

- Resume runs diff-derived mutation verification at HEAD before any repair.
- No survivor at HEAD → skip repair and continue the publication tail.
- A survivor at HEAD → repair that survivor, not the one recorded on `loop_finished`.
- The recorded survivor is diagnostic only; it never drives repair on its own.

## Acceptance criteria

- [ ] Test: recorded survivor, verifier at HEAD returns no survivor → no repair invocation, publication tail runs; fails against the pre-fix resume path.
- [ ] Test: recorded survivor A, verifier at HEAD returns survivor B → repair targets B; exhausted settlement names B.
- [ ] Test: recorded survivor A still survives at HEAD → repair targets A (unchanged behavior).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — resumed mutation repair re-verifies HEAD first.
- `v2/docs/operator-runbook.md` — committing a killing test before `resume` lets publication continue without repair.
