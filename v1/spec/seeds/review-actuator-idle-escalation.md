---
name: review-actuator-idle-escalation
---

# Idle-watchdog escalation for the review actuator

## Problem

The patch review actuator (the code-writing role that applies the review
verdict) repeatedly stalls mid-verdict-execution and soaks the full 30-minute
iteration wall before the watchdog kills it — no idle escalation, no fallback
to a stronger agent. Observed 2026-06-30 on #863 and #866: cursor (Composer
2.5) stalled ~22–25 min into verdict application (`last_output_age_ms` >
1,300,000), hit `[watchdog] iteration timeout fired after 1800000ms`, then the
run recovered by re-spawning the actuator or marking completed. ~30 min
wall-clock lost per stall; recurring across sessions.

Root cause: idle-output escalation is **patch-implementation only** (runbook:
"Idle-timeout escalation (patch implementation only)"). The review actuator
runs under the review phase, which has no idle-escalation path — it waits for
the hard iteration timeout, not the shorter idle-output watchdog. So a stalled
review actuator rides the full 30-min wall every time.

## Scope (for plan → run)

- Extend idle-output watchdog escalation to the review actuator (and shrink
  actuator if it shares the same stall profile): when the actuator stalls on
  output for the idle timeout and a later `agentOrder` entry remains, shift to
  the next agent and retry the verdict application.
- Keep the hard iteration timeout as the terminal stop when no later rung
  remains.

## Out of scope

- Review-panel read-only roles (adversary/advocate/adjudicator) — they make no
  changes and have a different stall profile; leave their timeout behavior
  unchanged unless a stall is observed there too.
- v2 shared invocation liveness policy (tracked in
  `v2/spec/seeds/invocation-liveness-policy.md`) — this seed is the v1
  shipping-surface fix; v2 designs the general policy separately.
- Shortening the iteration timeout itself (the fix is escalation, not a
  tighter wall).

## Decisions (seed-level — refine in plan)

- Idle-output escalation applies to the review actuator when a later
  `agentOrder` entry remains — rules out soaking the 30-min wall on a stall
  that a stronger agent could finish.
- Escalation stderr mirrors patch-impl idle escalation shape
  (`<agent>: idle timeout; escalating to next agent`) with a `review:` or
  `review actuator:` prefix to distinguish the phase — rules out ambiguity
  with patch-impl idle escalation lines.
- Terminal stop (exit 8 / `watchdog-idle-timeout`) returns only after the final
  rung stalls — same bounded-tail contract as patch-impl.
- Shrink actuator shares the escalation path if its stall profile matches
  (code-writing role on the same `reviewActuator` resolution) — rules out
  divergent stall handling for symmetric code-writing roles.
- Deferred to first consumer: whether the re-spawned actuator re-reads the
  verdict or re-runs the full review pass — pin when the escalation call-site
  is drafted.

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers the review actuator
  (and shrink actuator), not patch-implementation only.
- `v2/docs/v1-behaviors.md` — review-actuator idle escalation + terminal stop
  on final-rung stall.
- `v1/docs/operator-runbook.md` — drop the "review actuator soaks the 30-min
  wall" observation once shipped; note the recovery is now automatic
  escalation, not a re-spawn.

## Prerequisites

- Idle-output watchdog escalation exists for patch implementation (runbook +
  `v1/src/modes/patch/` invocation binding).
- Review actuator resolves from `modes.patch.subRoleAgentOrder.reviewActuator`
  (or `modes.patch.agentOrder`) and stays head-only today
  (`reviewActuator[0]`).
- `v2/spec/seeds/invocation-liveness-policy.md` tracks the v2 general policy
  (this seed is the v1 fix, not a duplicate).
