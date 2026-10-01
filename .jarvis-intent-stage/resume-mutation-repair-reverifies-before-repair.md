---
name: resume-mutation-repair-reverifies-before-repair
---

# Resumed mutation repair re-verifies HEAD before repairing

Unsplit rationale: the fix is confined to review-mutation resume finalization in `workflow-runner-resume.ts` (HEAD diff-derived verification before auto-derived repair); tests and operator docs ride the same surface.

## Primary implementation surface

- `v2/src/execution/workflow-runner-resume.ts` (`replayMutationFinalization` / auto-derived surviving-mutation repair admission)

## Problem

On resume, `replayMutationFinalization` rebuilds the survivor from the prior `loop_finished` via `survivingMutationErrorFromTerminalRecord` and hands it to `runAutoDerivedSurvivingMutationRepair`, which enters repair without re-running diff-derived verification. When the operator already committed a killing test, repair works on an already-killed mutant and settles through `settleMutationRepairExhausted` carrying the stale survivor.

## Decisions

- Resume runs diff-derived mutation verification at HEAD before any repair.
- No survivor at HEAD → skip repair and continue the publication tail.
- A survivor at HEAD → repair that survivor, not the one recorded on `loop_finished`.
- The recorded survivor is diagnostic only; it never drives repair on its own.

## Prerequisites

## Acceptance criteria

- [ ] Test: recorded survivor, verifier at HEAD returns no survivor → no repair invocation, publication tail runs; fails against the pre-fix resume path.
- [ ] Test: recorded survivor A, verifier at HEAD returns survivor B → repair targets B; exhausted settlement names B.
- [ ] Test: recorded survivor A still survives at HEAD → repair targets A (unchanged behavior).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — resumed mutation repair re-verifies HEAD first.
- `v2/docs/operator-runbook.md` — committing a killing test before `resume` lets publication continue without repair.
