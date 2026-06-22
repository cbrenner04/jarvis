---
name: actuator-role-model-floor
---

# Don't route the one-shot actuator to a model too weak to act

## Deferred (2026-06-21) — folds into [[deterministic-model-tiering-policy]]

Deferred during the overlord batch: this is the **floor-half** of the model-tiering ladder, and it
**depends on config granularity that doesn't exist yet.** You cannot floor "the actuator" today —
`modes.patch.agentOrder` sets the model for the *whole* patch mode (actuator + fix-up), not the
actuator sub-role. So this seed can't be implemented without first adding sub-mode role→model
granularity, which is exactly the [[deterministic-model-tiering-policy]] work. Implement it there
(declared-tier floor + escalate-on-failure), not as a standalone. Kept here as the concrete
floor requirement that policy must satisfy.

## Problem

J (#310) added model-tiering guidance for read-only **review/shrink** roles — faster/cheaper
models there are fine. The **actuator** (the patch-mode one-shot that edits code) is the opposite
risk: this session a weak fallback model (haiku) answered the actuator prompt *conversationally*
("do you want me to implement or review?") and no-progress-stopped in 15s; it also struggled to
write multi-turn behavioral tests and was slow enough on big refactors to hit iteration
timeouts. A cheap model is acceptable for review but risky for the actuator.

## Direction

Extend J's tiering to the actuator using the existing fallback-order config: enforce a model
floor for the actuator role (or warn/skip when the next fallback binding is below it), so the
harness doesn't spend an attempt on a model that can't actuate. Keep review/shrink free to use
cheap models. Use what exists — the per-machine agent fallback order and J's role/model mapping —
rather than new orchestration.

## Out of scope

- Review/shrink tiering — already shipped (J); unchanged.
- A new model registry — bind to the existing fallback-order config.

## References

- `v1/spec/completed/2026-06-20T06-29-05Z-review-shrink-model-tiering/00-model-tiering-guidance.md`
  — J's role/model guidance to extend.
- `v1/docs/agents.md` — agent fallback order the floor binds to.
