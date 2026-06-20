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
- Guidance names an illustrative tier split (a fast/cheap reviewer tier vs an
  implementation-grade actuator tier) rather than staying purely abstract. Rules
  out "assign faster models" with no concrete example, which is nearly
  contentless. Tiers are illustrative, not pinned model IDs, since model IDs
  churn.
- Guidance warns that `modes.review.agentOrder` is one shared resolution path
  driving reviewers in both plan-mode self-review and patch-mode review: setting
  it to speed up patch review simultaneously retunes plan-mode self-review. Rules
  out presenting the knob as patch-review-only.
- Guidance pairs the faster-reviewer recommendation with a cost/quality caveat:
  reviewers produce the verdict the actuator acts on, so weaker reviewer models
  trade defect-catch quality for speed. Rules out framing the tradeoff as
  cost/latency-only.

## Task checklist

- [ ] Add a model-tiering guidance section to `v1/docs/agents.md` covering
  read-only review roles vs review/shrink actuators, which config order each
  resolves from, an illustrative fast-reviewer vs implementation-grade-actuator
  tier split, the cost/quality caveat, the `modes.review.agentOrder` cross-mode
  coupling, and the unset-default takeaway (a cheap `modes.plan.agentOrder`
  already yields tiered reviewers for free).
- [ ] Extend the `modes.review.agentOrder` description in `v1/docs/config.md`
  with the tiering use case (faster models for read-only review roles) and a
  pointer that actuators use `modes.patch.agentOrder`.
- [ ] Reframe the `v2/docs/v1-behaviors.md` note as the positive order-resolution
  mapping (read-only review roles resolve `modes.review.agentOrder` falling back
  to `modes.plan.agentOrder`; review and shrink actuators resolve
  `modes.patch.agentOrder`) with tiering as operator guidance over that existing
  resolution and no new runtime selection logic.

## Acceptance criteria

- [x] `v1/docs/agents.md` documents that read-only review roles (adversary,
  advocate, adjudicator) resolve their agent order from
  `modes.review.agentOrder` falling back to `modes.plan.agentOrder`, and that
  the review actuator and shrink actuator resolve from `modes.patch.agentOrder`.
- [x] `v1/docs/agents.md` recommends assigning faster models to the read-only
  review roles while keeping implementation-grade models on the review and
  shrink actuators, naming an illustrative tier split (fast/cheap reviewer tier
  vs implementation-grade actuator tier).
- [x] `v1/docs/agents.md` states that `modes.review.agentOrder` drives reviewers
  in both plan-mode self-review and patch-mode review, so setting it retunes
  both.
- [x] `v1/docs/agents.md` caveats that faster reviewer models trade defect-catch
  quality for speed, since reviewers produce the verdict the actuator acts on.
- [x] `v1/docs/agents.md` notes `modes.review.agentOrder` only needs setting when
  `modes.plan.agentOrder` is expensive; a cheap plan order already yields tiered
  reviewers for free.
- [x] `v1/docs/config.md`'s `modes.review.agentOrder` documentation describes
  the faster-model-for-read-only-review-roles use case and notes that review and
  shrink actuators use `modes.patch.agentOrder`, not `modes.review.agentOrder`.
- [x] `v2/docs/v1-behaviors.md` records the order-resolution mapping (read-only
  review roles resolve `modes.review.agentOrder` falling back to
  `modes.plan.agentOrder`; review and shrink actuators resolve
  `modes.patch.agentOrder`) with model tiering as operator guidance layered over
  it and no new runtime selection logic.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: review/shrink model tiering guidance — config order each
  role resolves from, illustrative tier split, cost/quality caveat, cross-mode
  coupling of `modes.review.agentOrder`, and the unset-default takeaway.
- `v1/docs/config.md`: tiering use case on the existing `modes.review.agentOrder`
  description; actuators use `modes.patch.agentOrder`.
- `v2/docs/v1-behaviors.md`: review/shrink agent-order resolution mapping with
  model tiering as operator guidance layered over it.
