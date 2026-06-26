---
name: actuator-model-capability-floor
---

# Enforce a configurable capability floor for actuator model selection

## Behavior

Actuation roles (patch, review-actuator, shrink-actuator — all resolve from
`modes.patch.agentOrder`) must never run on a model below a configurable
minimum-capability floor, at initial selection or on quota/error fallback.

- Operator configures a minimum-capability floor for actuation roles.
- Initial actuator selection skips in-order entries below the floor.
- Quota/error fallback skips below-floor entries rather than silently degrading.
- When no in-order actuator meets the floor, the run surfaces a clear error
  naming the role and floor instead of running a below-floor model.

Plan weighs how to rank model capability (so "below floor" is well-defined) and
how floor-skipping composes with the existing quota-fallback ladder.

## Out of scope

- Specific model assignments for the operator's setup (stays in `config.json`).
- Dynamic per-task difficulty scoring — static floor only.
- Per-sub-role agent orders (separate intent).

## Prerequisites
