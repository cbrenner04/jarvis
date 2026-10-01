---
name: slot-redrive-excludes-iteration-gate-budget
---

# Slot re-drive never treats iteration gate budget refusals as waiting rows

## Problem

The slot re-drive coordinator re-drives only `slot_contention` `gate_invocation_refused` rows. A new `iteration_gate_budget` refusal cause must stay out of that queue even if recovery metadata or test fixtures surface the cause on a failed row.

## Decisions

- `slotRedriveWaiting` / redrive eligibility ignore `iteration_gate_budget`; rules out automatic resume for per-iteration budget exhaustion (the write loop continues in-process instead).

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts` proves an `iteration_gate_budget` cause is never re-drive eligible; fails against main if the coordinator would enqueue it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — slot re-drive applies only to `slot_contention`, not `iteration_gate_budget`.

## Primary implementation surface

v2/src/daemon/daemon-slot-redrive.ts

## Prerequisites

- Implement write iterations admit at most two classified full-suite gate shell commands per iteration; a third is refused with cause `iteration_gate_budget` before ceiling headroom or slot checks.
- `iteration_gate_budget` refusals checkpoint settled edits and advance the write loop with a gate-budget reprompt instead of terminal `gate_invocation_refused` settlement.
