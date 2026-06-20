---
name: review-shrink-model-tiering
---
# Review and shrink model tiering config

**Scope.** Config and docs only; no new runner logic.

## Problem

Review adversary/advocate/adjudicator and shrink agents default to the same model order as implementation, paying thinking-model latency on read-only roles.

## Desired behavior

Optional `modes.review.agentOrder` entries (and documented shrink agent order guidance) let operators assign faster models to read-only review roles vs the actuator. Defaults match today. Document recommended faster models for adversary/advocate/adjudicator vs implementation/shrink actuator.

## Decisions

- Config/docs slice only; no new runner selection logic. Rules out implementing per-role model routing in harness code.
- Defaults preserve current agent order when config is unset. Rules out changing default models for existing operators.
- Guidance covers review roles and shrink actuator distinction. Rules out documenting only review without shrink operator knobs.

## Acceptance signals

- Config schema accepts optional review agent order overrides documented in config docs.
- Operator docs describe faster-model guidance for read-only review roles vs actuator.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: review/shrink model tiering guidance and config keys.
- `v1/docs/config.md`: optional `modes.review.agentOrder` entries.
- `v2/docs/v1-behaviors.md`: config-only review model tiering note.

## Out of scope

- Harness logic to enforce per-role models.
- Changing review debate topology or pass count.
- New agent CLI integrations.

## Prerequisites
