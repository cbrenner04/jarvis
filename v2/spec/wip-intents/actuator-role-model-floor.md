---
name: actuator-role-model-floor
---

# Don't route the one-shot actuator to a model too weak to act

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

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the actuator model-floor behavior.
- Extend J's tiering guidance (`v1/spec/completed/2026-06-20T06-29-05Z-review-shrink-model-tiering/`
  landed it) to cover the actuator.

## References

- `v1/spec/completed/2026-06-20T06-29-05Z-review-shrink-model-tiering/00-model-tiering-guidance.md`
  — J's role/model guidance to extend.
- `v1/docs/agents.md` — agent fallback order (`claude → codex → cursor`) the floor binds to.
