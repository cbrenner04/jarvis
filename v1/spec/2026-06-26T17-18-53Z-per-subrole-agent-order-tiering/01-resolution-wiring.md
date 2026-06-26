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
- `reviewPanel` routing mechanism: all three review entry points share one
  `resolveReviewAgentOrder(cfg)` call site (`review/run.ts`) with no caller
  discriminator. The patch-run caller (`patch/review.ts` → `runReview`) threads
  the resolved `reviewPanel` order in through `RunReviewOptions`; when that
  field is absent, `runReview` resolves via `resolveReviewAgentOrder` exactly as
  today. Rules out branching on a caller flag inside the resolver, which would
  bake patch-run knowledge into the shared standalone/plan-self-review path.
- `patchActuator` resolution feeds the same list that patch-tier start-index
  slicing (`resolvePatchTierStartIndex`) operates on; tiering composes on top of
  the resolved order. Rules out applying the override after slicing, which would
  desync the ladder from the operator's chosen order.
- The verdict actuator and shrink agent both resolve from the `reviewActuator`
  order (they are one tier per the intent), but consume it differently and each
  keeps its current consumption mode: the verdict actuator reads only the head
  (`reviewActuator[0]`, no quota fallback gained — same as today's
  `agentOrder[0]?.model`); the shrink agent maps the full `reviewActuator` list
  for quota fallback. Rules out forcing both onto one consumption shape, which
  would either grant the verdict actuator fallback it never had or strip the
  shrink agent's.

## Task checklist

- Add a resolver (e.g. `resolveSubRoleAgentOrder(cfg, subRole)`) returning the
  override for the sub-role when present, else the per-mode fallback above.
- Route the patch loop's agent build to the `patchActuator` order (the list the
  tier start-index slices).
- Route the review panel (adversary/advocate/adjudicator) during patch review to
  the `reviewPanel` order by threading it through `RunReviewOptions` from
  `patch/review.ts`; leave the default `runReview` path resolving via
  `resolveReviewAgentOrder`.
- Route the verdict actuator to the `reviewActuator` head (`[0]`) and the shrink
  agent to the full `reviewActuator` list, each preserving its current
  consumption mode.
- Verify unset behavior: with no `subRoleAgentOrder`, every sub-role resolves to
  the same order as today.
- Update `v2/docs/v1-behaviors.md` (the resolution entry) and
  `v1/docs/agents.md` (Review/shrink model tiering section) to describe the new
  per-sub-role overrides and their fallbacks, stating that the single
  `reviewActuator` key governs both the verdict actuator (head-only) and the
  shrink agent (full list).

## Acceptance criteria

- [ ] With `modes.patch.subRoleAgentOrder` unset, the patch loop, review panel,
      verdict actuator, and shrink agent each resolve to the same agent order as
      before this change (existing patch/review/shrink tests stay green).
- [ ] With `subRoleAgentOrder.patchActuator` set, the patch implementation loop
      uses that order (patch-tier start-index slicing applies to it); the review
      panel and review/shrink actuators are unaffected.
- [ ] With `subRoleAgentOrder.reviewActuator` set, the verdict actuator reads the
      head (`reviewActuator[0]`) model while the patch loop and review panel are
      unaffected.
- [ ] With `subRoleAgentOrder.reviewActuator` set, the shrink agent uses the full
      `reviewActuator` list while the patch loop and review panel are unaffected.
- [ ] With `subRoleAgentOrder.reviewPanel` set, the patch-run adversary/advocate/
      adjudicator roles use that order while the actuators are unaffected.
- [ ] An override preserves quota-fallback iteration over the full list for the
      shrink agent and the patch loop, while the verdict actuator stays head-only
      (no fallback gained).
- [ ] Standalone `jarvis review` resolves its review agent order unchanged: the
      `resolveReviewAgentOrder` describe block in `v1/test/config.test.ts` and
      `v1/test/modes/review/run.test.ts` stay green (the threaded `reviewPanel`
      order defaults to absent for this caller).
- [ ] Plan-mode self-review resolves its review agent order unchanged: the
      `resolveReviewAgentOrder` fallback tests in `v1/test/config.test.ts` (which
      pin `modes.review.agentOrder ?? modes.plan.agentOrder`) stay green.
- [ ] `v2/docs/v1-behaviors.md` and `v1/docs/agents.md` describe the three
      per-sub-role overrides and their per-mode fallbacks, including that
      `reviewActuator` governs both the verdict actuator (head-only) and the
      shrink agent (full list).

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the agent-order resolution entry to include
  the per-sub-role overrides and fallbacks.
- `v1/docs/agents.md` — extend Review/shrink model tiering with the new overrides.
