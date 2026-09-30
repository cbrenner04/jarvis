---
name: publication-inflow-mutation-repair
---

# Publication runs bounded mutation repair before terminal surviving_mutation_failed

## Problem

When the ready finalizer's diff-derived mutation check survives, completion publication settles terminal `surviving_mutation_failed` immediately; `write.mutation-repair` (up to `MAX_MUTATION_REPAIR_ATTEMPTS`) runs only after operator `jarvis run resume`.

## Decisions

- On publication-time `SurvivingMutationError`, drive the existing `runMutationRepairIteration` loop in-flow before settling `surviving_mutation_failed`, sharing `MAX_MUTATION_REPAIR_ATTEMPTS` with resume.
- Exhaustion or blocked repair still settles terminal `surviving_mutation_failed` resumable as today.

## Acceptance criteria

- [ ] `write-loop.test.ts` (extend ready-finalization / publication surviving-mutation coverage): completion publication with a publication-time surviving mutation logs `iteration_started` with prompt id `write.mutation-repair` before `loop_finished` with `loopOutcomeKind: "surviving_mutation_failed"`; fails when publication settles terminal `surviving_mutation_failed` without that repair iteration.

## Documentation updates

- `v2/docs/write-behavior.md` — publication-time mutation repair before terminal settlement.
- `v2/docs/operator-runbook.md` — first mutation-repair budget runs in-flow; resume only needed after exhaustion or pause.
- `v2/docs/v1-behaviors.md` — publication no longer settles `surviving_mutation_failed` before in-flow mutation repair is exhausted.

## Prerequisites
