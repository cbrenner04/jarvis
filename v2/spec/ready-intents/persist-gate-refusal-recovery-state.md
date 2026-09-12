---
name: persist-gate-refusal-recovery-state
---

# Persist gate-refusal recovery state

## Prerequisites

- The write loop distinguishes slot contention from ceiling-headroom refusal at the refusal site and checkpoints a quiesced slot-refused iteration before committing its refusal boundary.

## Module-boundary surface

- Persistence: run settlement and run-log evidence consumed by daemon recovery and observation.

## Problem

Durable run state records only `gate_invocation_refused`. After the process boundary, recovery cannot tell whether the daemon should await a lease or leave a fixed headroom condition to the operator, and it has no durable count with which to bound slot re-drives.

## Behavior

- Durable run evidence round-trips the gate-refusal cause and slot re-drive count, including across daemon restart.

## Decisions

- Store a closed refusal cause for slot contention versus ceiling headroom and a non-negative slot re-drive count; rules out parsing messages.
- Make the latest committed recovery state authoritative for daemon recovery and operator projection.
- Preserve compatibility for rows created before the fields existed by treating missing evidence as legacy undifferentiated refusal, not slot-retry permission.
- Keep gate command evidence and the existing `gate_invocation_refused` outcome.

## Acceptance criteria

- [ ] State-store and log-schema tests prove each refusal cause round-trips with its gate command and slot re-drive count; they fail against the pre-fix single-cause record.
- [ ] A reopen test proves the same recovery state survives closing and reopening the store.
- [ ] A compatibility test proves a legacy refusal without cause or count loads safely as an explicit legacy/unknown cause with no slot re-drive count.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — durable refusal cause, slot re-drive count, and legacy-row fallback.
- `v2/docs/v1-behaviors.md` — record the additive durable recovery evidence.
