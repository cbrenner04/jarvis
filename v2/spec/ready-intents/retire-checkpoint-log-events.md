---
name: retire-checkpoint-log-events
---

# Retire checkpoint reprompt log events

Unsplit rationale: Retiring the durable event contract is one persistence-bound behavior.

## Prerequisites

- Plan drafting, review, normalization, and durable guidance no longer require, author, or validate mutation/keystone checkpoint syntax, while the named pre-fix failing-test rule remains.
- Implement completion ignores checkpoint-shaped criteria, exposes no checkpoint verifier or reprompt prompts, and retains diff-derived verification as the sole mutation gate.
- Daemon resume no longer reconstructs or forwards checkpoint-specific reprompt context from durable logs.

## Primary implementation surface

- Persistence

## Problem

- The durable log schema still exposes three checkpoint-reprompt event families after their producers and replay consumers are gone.

## Behavior

- The appendable log-event contract contains no mutation-directive, guard-checkpoint, or keystone-directive reprompt variants or payload types.
- Generic log reading remains tolerant of historical JSON records without retaining typed handling for retired events.
- Operator log-follow behavior for active event kinds remains unchanged.

## Decisions

- Remove checkpoint event variants only after execution producers and daemon consumers are gone; rules out an uncompilable or partially live schema transition.
- Keep historical JSON parsing tolerant without retaining typed checkpoint events; rules out either breaking old log inspection or preserving retired API surface.

## Acceptance criteria

- [ ] Log append and inspection expose no checkpoint-reprompt event family or payload.
- [ ] A persisted historical checkpoint event remains tail-readable as generic JSON.
- [ ] Existing log sequence, truncation, follow, and active-event formatting tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove retired checkpoint log-event payloads and cross-link the surviving generic log contract.
- `v2/docs/v1-behaviors.md` — remove checkpoint log events from the durable behavior inventory.
