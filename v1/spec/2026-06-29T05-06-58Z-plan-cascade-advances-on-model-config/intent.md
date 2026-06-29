---
name: plan-cascade-advances-on-model-config
---

# Plan-mode agentOrder cascades advance past `model_config`

## Problem

Plan-mode agentOrder loops (`intent-split`, draft, name-only) set
`shouldAdvance` to `quota || error` only. A `model_config` result halts the
chain — `jarvis1 intent` exits `3` without trying cursor/claude. Per-agent
environment failures (codex shell-snapshot validation noise classified
`model_config`) are agent-specific; the next binary would not share them.

Prompt mode already advances on `model_config`; plan intent-split does not.

## Direction

Plan-mode `shouldAdvance` call sites advance to the next configured agent on
`model_config`, same as `error`. `jarvis1 intent` exits `3` only when every
agent in the order returned `model_config` (or the chain otherwise ends without
`ok`). Emit operator stderr on rotation comparable to quota fallback lines.

Resolve whether all `model_config` advances (like prompt) or only agent-env
errors advance while genuine bad-model-name stays terminal — pick (a) or (b) in
the spec ledger.

## Decisions

- Plan `shouldAdvance` includes `model_config` at intent-split, draft, and name-only — rules out fixing intent-split alone.
- Genuine bad model name exhausting every agent exits `3` — rules out silent success when all agents reject the configured model.
- Patch/review `model_config` stays terminal in this intent — rules out changing patch iteration or review runner fatal semantics here; prompt already advances and needs no code change.
- Deferred to first consumer: (a) advance all `model_config` vs (b) split agent-env errors from bad-model-name — pin when drafting subspecs.

## Out of scope

- Spawn classification precedence (separate intent).
- Operator shell rc fix.

## Documentation updates

- `v1/docs/quota-signals.md` — plan column for `model_config` fallback.
- `v1/docs/plan-mode.md` — model_config cascade behavior for draft/intent phases.
- `v1/docs/agents.md` — fallback order if it documents plan agentOrder.
- `v2/docs/v1-behaviors.md` — plan vs prompt vs review model_config cascade.

## Prerequisites
