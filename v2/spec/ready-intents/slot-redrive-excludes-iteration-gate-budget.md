---
name: slot-redrive-excludes-iteration-gate-budget
---

# Slot re-drive never treats iteration gate budget refusals as waiting rows

## Problem

`slotRedriveWaiting` already admits only `gateRefusalRecoveryState.cause === "slot_contention"`. Budget exhaustion must stay in-process (intent 1) and must not widen redrive if the shared recovery cause enum or redrive predicates evolve.

## Decisions

- `iteration_gate_budget` is not a `GateRefusalRecoveryCause`; budget exhaustion never writes `gate_refusal_recovery_state`.
- No separate daemon predicate change unless redrive eligibility loosens; the regression pin lives in intent 1’s `daemon-slot-redrive.test.ts` extension (same cast pattern as `ceiling_headroom`).

## Acceptance criteria

- [ ] `per-iteration-agent-gate-budget` subspec checked — its `daemon-slot-redrive.test.ts` pin covers synthetic `iteration_gate_budget` rows.

## Documentation updates

- None (operator-runbook slot re-drive note merges on intent 1 at plan time).

## Primary implementation surface

(none — defensive test pin owned by `per-iteration-agent-gate-budget`)

## Prerequisites

- Implement write iterations admit at most two classified full-suite gate shell commands per iteration; a third is refused with cause `iteration_gate_budget` before ceiling headroom or slot checks.
- `iteration_gate_budget` refusals checkpoint settled edits and advance the write loop with a gate-budget reprompt instead of terminal `gate_invocation_refused` settlement.
