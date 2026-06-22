---
name: escalate-actuator-on-no-progress
---

# Auto-advance the agent on a no-progress stop instead of exiting

## Problem

A no-progress stop in patch mode exits the run (exit 4); the operator then manually bumps the
model and re-runs. The cheapest actuator (haiku) routinely no-progress-stalls on non-trivial
actuation — answers conversationally, or edits silently and trips the idle watchdog — and recovery
is pure operator toil. Today the per-mode `agentOrder` advances to the next agent only on **quota**
signals, not on no-progress. Observed live this session: haiku stalled in 22s on the biome-config
spec; a manual switch to sonnet landed it clean on the next run.

## Decision

On a no-progress stop, **advance to the next `agentOrder` entry and retry the iteration** — the
same `activeAgents.shift()` + continue that quota fallback already does — instead of returning
exit 4. Only return exit 4 once the ladder is exhausted (the last rung also no-progressed).
`agentOrder` thus doubles as the escalation ladder; reuses existing config, no new schema.

**Known tradeoff (accepted, worth trying):** advancing `agentOrder` changes the **agent _and_
model** together (default order jumps `claude:haiku` → `codex:gpt-5.4`), not just "haiku → a
stronger Claude." There is no per-agent model ladder in config today, so reuse is the only
no-new-config option. The operator steers it by ordering the list as a strength ladder
(`claude:haiku, claude:sonnet, claude:opus, …`) so a stall climbs strength before crossing
providers, with cross-agent quota fallbacks in the tail. If the cross-agent jump proves wrong in
practice, a dedicated strength-only ladder is the follow-on.

## Scope

- Mirror the quota-fallback block (`v1/src/modes/patch/iteration.ts:1269-1293`) in the no-progress
  block (`iteration.ts:1228-1254`): `activeAgents.shift()`, and if agents remain, `state.iteration
  += 1; return continue`; else return exit 4.
- Bounded: advance through the order at most once per spec (the natural consequence of shifting a
  finite `activeAgents`).

## Out of scope (staged follow-ons)

- **Difficulty score** (`trivial|standard|hard`, stamped at plan/intent, operator-overridable) that
  sets the *starting* rung so a known-hard spec skips the wasted cheap attempt — follow-on, recorded
  in [[deterministic-model-tiering-policy]].
- Escalating on other deterministic failures (nonzero exit, gate-fail) — later; **no-progress only**
  for now.
- Per-sub-role (actuator vs fix-up vs plan passes) model granularity — v2; one model per mode is
  enough today. See [[deterministic-model-tiering-policy]].
- Dedicated strength-only ladder separate from the quota `agentOrder` — only if the cross-agent jump
  proves wrong.
- **Absorbs the actuator-role-model-floor seed**: a too-weak actuator now self-recovers by climbing
  the ladder, so no static floor is needed.

## Documentation updates

- `v1/docs/agents.md` — `agentOrder` now advances on no-progress too; document it as an escalation
  ladder (order cheap→strong), and the agent+model coupling.
- `v1/docs/quota-signals.md` and/or `v1/docs/run-loop.md` — no-progress now escalates before exiting.
- `v2/docs/v1-behaviors.md` — patch run-loop behavior change (no-progress is no longer an immediate
  exit-4).

## References

- `v1/src/modes/patch/iteration.ts` — no-progress block (~1228-1254) to mirror on the quota-fallback
  block (~1269-1293); `activeAgents` is the in-memory ladder derived from `agentOrder`.
- `v1/src/modes/patch/run.ts:335` — exit-code → reason map (exit 4 = no-progress).
- Evidence: haiku 22s no-progress stall this session → manual sonnet bump → criteria-complete.
