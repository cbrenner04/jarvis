# Resolve and wire sub-role agent orders

## Problem

With the `modes.patch.subRoleAgentOrder` schema in place (`00`), nothing reads
it yet. This subspec adds the resolver and routes each patch-run sub-role through
it so that an override, when set, governs that sub-role's order, and an absent
override falls back to today's per-mode resolution — leaving unset configs
byte-identical in behavior.

## Decisions

- Fallback per sub-role when its override is absent:
  - `reviewPanel` → `resolveReviewAgentOrder(cfg)`
    (`modes.review.agentOrder ?? modes.plan.agentOrder`)
  - `reviewActuator` → `modes.patch.agentOrder`
  - `patchActuator` → `modes.patch.agentOrder`
  These reproduce the current sources exactly; rules out collapsing all three to
  a single fallback, which would change review-panel resolution.
- Scope is the patch run only (`jarvis run`: completion-pipeline review +
  shrink, plus the patch loop). Standalone `jarvis review` and plan-mode
  self-review keep resolving via `resolveReviewAgentOrder` untouched. Rules out
  applying `reviewPanel` globally, which the out-of-scope boundary forbids.
- `patchActuator` resolution feeds the same list that patch-tier start-index
  slicing (`resolvePatchTierStartIndex`) operates on; tiering composes on top of
  the resolved order. Rules out applying the override after slicing, which would
  desync the ladder from the operator's chosen order.
- The verdict actuator and shrink agent both resolve from the `reviewActuator`
  order (they are one tier per the intent). Rules out splitting them, which the
  intent groups together.

## Task checklist

- Add a resolver (e.g. `resolveSubRoleAgentOrder(cfg, subRole)`) returning the
  override for the sub-role when present, else the per-mode fallback above.
- Route the patch loop's agent build to the `patchActuator` order (the list the
  tier start-index slices).
- Route the review panel (adversary/advocate/adjudicator) during patch review to
  the `reviewPanel` order.
- Route the verdict actuator and shrink agent to the `reviewActuator` order.
- Verify unset behavior: with no `subRoleAgentOrder`, every sub-role resolves to
  the same order as today.
- Update `v2/docs/v1-behaviors.md` (the resolution entry) and
  `v1/docs/agents.md` (Review/shrink model tiering section) to describe the new
  per-sub-role overrides and their fallbacks.

## Acceptance criteria

- [ ] With `modes.patch.subRoleAgentOrder` unset, the patch loop, review panel,
      verdict actuator, and shrink agent each resolve to the same agent order as
      before this change (existing patch/review/shrink tests stay green).
- [ ] With `subRoleAgentOrder.patchActuator` set, the patch implementation loop
      uses that order (patch-tier start-index slicing applies to it); the review
      panel and review/shrink actuators are unaffected.
- [ ] With `subRoleAgentOrder.reviewActuator` set, the verdict actuator and shrink
      agent use that order while the patch loop and review panel are unaffected.
- [ ] With `subRoleAgentOrder.reviewPanel` set, the patch-run adversary/advocate/
      adjudicator roles use that order while the actuators are unaffected.
- [ ] Standalone `jarvis review` and plan-mode self-review resolve their review
      agent order unchanged (existing review-mode tests stay green).
- [ ] `v2/docs/v1-behaviors.md` and `v1/docs/agents.md` describe the three
      per-sub-role overrides and their per-mode fallbacks.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the agent-order resolution entry to include
  the per-sub-role overrides and fallbacks.
- `v1/docs/agents.md` — extend Review/shrink model tiering with the new overrides.
