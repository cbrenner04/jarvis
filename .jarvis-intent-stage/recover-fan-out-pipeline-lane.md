---
name: recover-fan-out-pipeline-lane
---

# Recover a hand-corrected fan-out pipeline lane

Unsplit rationale: The required code and tests stay within the daemon's pipeline stage-recovery boundary; CLI parsing, persistence, and workflow execution already carry the named branch unchanged.

## Prerequisites

## Primary implementation surface

- Daemon

## Problem

`pipeline recover <id> <branch-key>` rejects a failed plan stage after an intent split because recovery refuses the resolver's fan-out result, leaving a hand-corrected `.jarvis-plan-stage/` tree no landing path.

## Decisions

- Narrow a fan-out plan-stage resolution to the result paired with the named branch by ordinary fan-out branch ordering before dropping its write step and selecting its plan-tree review landing; rules out rejecting every fan-out resolution or selecting the first result regardless of branch.
- Recover and continue only the named branch's rows while leaving sibling rows, stages, and approval gates unchanged; rules out reopening or dispatching sibling lanes.
- Preserve `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, and attempt-time `operator_blocker` refusals for the named branch; rules out weakening recovery admission or staged-tree safety checks.
- Keep `branchKey` mandatory for `pipeline recover`; rules out guessing a branch for an unscoped fan-out pipeline.
- Revalidate and land the corrected staged tree through the existing recovery review path without redispatching the plan write step; rules out redrafting the operator's correction as `pipeline resume` does.

## Acceptance criteria

- [ ] `pipeline-stage-recovery.test.ts` seeds a split pipeline with a failed plan row on a non-first branch and proves `resolveBlockedPlanStageRecoveryTarget` selects that branch's review landing, drops its write step, and fails against the baseline fan-out refusal.
- [ ] `daemon-pipeline-recover.test.ts` proves `pipeline_recover` admits the named fan-out branch and lands its hand-corrected staged tree without invoking the plan write step.
- [ ] `pipeline-stage-recovery.test.ts` proves recovery and continuation leave sibling branch rows, stages, and approval gates byte-for-byte unchanged.
- [ ] `pipeline-stage-recovery.test.ts` and `daemon-pipeline-recover.test.ts` preserve the named branch's `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, and `operator_blocker` refusals, and preserve mandatory branch targeting.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — fan-out branch targeting, corrected-tree landing, sibling isolation, and mandatory branch key for `pipeline recover`.
- `v2/docs/daemon-host.md` — branch-scoped fan-out resolution narrowing and unchanged recovery guards.
- `v2/docs/v1-behaviors.md` — record fan-out branch recovery in the v2 parity baseline.
