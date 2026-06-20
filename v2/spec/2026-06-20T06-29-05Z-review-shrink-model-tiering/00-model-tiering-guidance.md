# Document review/shrink model tiering guidance

## Problem

Operators have no guidance on running cheaper/faster models on read-only review
roles while keeping strong models on code-writing actuators. The capability
already exists in config but is undocumented as a tiering pattern.

## What already exists (do not re-add)

- `modes.review.agentOrder` is already a validated optional config key
  (`v1/src/config.ts`), already resolved by `resolveReviewAgentOrder` with a
  fallback to `modes.plan.agentOrder`, and already documented structurally in
  `v1/docs/config.md` (§`modes.review.passes` and `modes.review.agentOrder`).
- Actual order resolution today:
  - Read-only review roles (adversary, advocate, adjudicator):
    `modes.review.agentOrder ?? modes.plan.agentOrder`.
  - Review actuator (writes code from the verdict): `modes.patch.agentOrder`.
  - Shrink actuator (writes code): `modes.patch.agentOrder`.

This subspec adds **operator guidance prose only**. No schema field, no
validation, and no runner selection logic is added or changed. There is no
separate shrink agent-order knob; shrink tiering is expressed through
`modes.patch.agentOrder`.

## Decisions

- Docs-only change; the tiering knobs already exist. Rules out adding a new
  config field or a `modes.shrink.agentOrder` key.
- Guidance states the actual resolution (reviewers fall back to
  `modes.plan.agentOrder`, not patch/implementation order). Rules out repeating
  the intent's inexact "same order as implementation" framing as fact.
- Guidance separates read-only roles (safe to run faster models) from actuators
  (review + shrink, which write code and warrant implementation-grade models).
  Rules out documenting only the review reviewers and omitting the shrink
  actuator distinction.

## Task checklist

- [ ] Add a model-tiering guidance section to `v1/docs/agents.md` covering
  read-only review roles vs review/shrink actuators and which config order each
  resolves from.
- [ ] Extend the `modes.review.agentOrder` description in `v1/docs/config.md`
  with the tiering use case (faster models for read-only review roles) and a
  pointer that actuators use `modes.patch.agentOrder`.
- [ ] Add a config-only note to `v2/docs/v1-behaviors.md` recording that model
  tiering is operator guidance over existing order resolution with no new
  runtime selection logic.

## Acceptance criteria

- [ ] `v1/docs/agents.md` documents that read-only review roles (adversary,
  advocate, adjudicator) resolve their agent order from
  `modes.review.agentOrder` falling back to `modes.plan.agentOrder`, and that
  the review actuator and shrink actuator resolve from `modes.patch.agentOrder`.
- [ ] `v1/docs/agents.md` recommends assigning faster models to the read-only
  review roles while keeping implementation-grade models on the review and
  shrink actuators.
- [ ] `v1/docs/config.md`'s `modes.review.agentOrder` documentation describes
  the faster-model-for-read-only-review-roles use case and notes that review and
  shrink actuators use `modes.patch.agentOrder`, not `modes.review.agentOrder`.
- [ ] `v2/docs/v1-behaviors.md` records that review/shrink model tiering is
  config/operator guidance over existing agent-order resolution with no new
  runtime selection logic.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: review/shrink model tiering guidance and the config order
  each role resolves from.
- `v1/docs/config.md`: tiering use case on the existing `modes.review.agentOrder`
  description; actuators use `modes.patch.agentOrder`.
- `v2/docs/v1-behaviors.md`: config-only review/shrink model tiering note.
