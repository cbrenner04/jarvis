---
name: review-actuator-idle-escalation
---

# Review actuator idle-output watchdog escalation

## Problem

Patch review verdict actuator stalls mid-verdict with no idle escalation; the phase rides the 30-minute iteration wall instead of advancing to the next configured agent.

## Scope

When the review actuator hits the idle-output watchdog and a later `reviewActuator` rung remains, shift to the next agent and retry verdict application. Final rung keeps terminal exit `8` / `watchdog-idle-timeout`. Hard `iterationTimeoutMs` stays terminal with no cascade.

Out of scope: review-panel read-only roles; shortening `iterationTimeoutMs`; v2 invocation-liveness policy.

## Decisions

- Idle escalation traverses `modes.patch.subRoleAgentOrder.reviewActuator`, else `modes.patch.agentOrder` — rules out soaking the 30-min wall while a stronger rung remains.
- Escalation stderr mirrors patch-impl shape with a `review actuator:` (or `review:`) prefix — rules out ambiguous idle lines across phases.
- Terminal `watchdog-idle-timeout` only on final-rung idle stall — rules out unbounded same-agent retry.
- Non-terminal idle escalation records `watchdog-idle-timeout-fallback` telemetry — rules out losing per-rung stall visibility.
- Deferred to first consumer: whether retried actuator re-reads on-disk verdict vs re-runs review — pin at escalation call-site.

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers review actuator, not patch-implementation only.
- `v1/docs/quota-signals.md` — idle-timeout escalation section covers review actuator.
- `v1/docs/run-loop.md` — review actuator idle escalate-then-terminal semantics.
- `v1/docs/operator-runbook.md` — review actuator stall recovers via auto-escalation, not 30-min soak.
- `v2/docs/v1-behaviors.md` — review-actuator idle escalation + final-rung terminal stop.

## Prerequisites

- Patch implementation idle-output watchdog escalates through remaining `agentOrder` rungs when a later rung remains
- Review actuator resolves agents from `modes.patch.subRoleAgentOrder.reviewActuator` or `modes.patch.agentOrder`
