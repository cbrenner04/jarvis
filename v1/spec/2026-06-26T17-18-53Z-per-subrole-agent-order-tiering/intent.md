---
name: per-subrole-agent-order-tiering
---

# Allow per-sub-role agent-order assignment

## Behavior

Operators can assign agent orders per sub-role instead of one
`modes.patch.agentOrder` serving every actuator. The three sub-roles tier
independently:

- read-only review roles (adversary/advocate/adjudicator)
- review/shrink actuators
- patch actuator

Behavior:

- An operator sets a sub-role override and that sub-role resolves its agent
  order from the override.
- When a sub-role override is absent, resolution falls back to the existing
  per-mode order (today's behavior), so unset config is unchanged.

Plan weighs config shape (additive per-sub-role keys vs. a tiering block) against
the current `modes.{patch,plan,review}.agentOrder` resolution.

## Out of scope

- Specific model assignments for the operator's setup (stays in `config.json`).
- The actuator capability floor (separate intent).

## Prerequisites
