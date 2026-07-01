---
name: shrink-actuator-idle-escalation
---

# Shrink actuator idle-output watchdog escalation

## Problem

Shrink uses the same `reviewActuator` ladder as the verdict actuator but terminates on idle-output stall instead of escalating — same patch-only asymmetry.

## Scope

When shrink hits the idle-output watchdog and a later `reviewActuator` rung remains, shift and retry the shrink invocation. Final rung keeps terminal exit `8` / `watchdog-idle-timeout`. Hard `iterationTimeoutMs` stays terminal with no cascade.

Out of scope: review-panel read-only roles; shortening `iterationTimeoutMs`.

## Decisions

- Idle escalation uses the same `reviewActuator` order shrink already uses for quota fallback — rules out a separate shrink-only ladder.
- Escalation stderr mirrors patch/review idle shape with a shrink-distinguishing prefix — rules out ambiguous stderr lines.
- Terminal `watchdog-idle-timeout` only when no later rung remains — rules out divergent tail contract from review actuator.
- Shares escalation mechanics with review actuator — rules out divergent idle handlers for symmetric code-writing roles.

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers shrink actuator.
- `v1/docs/run-loop.md` — shrink idle escalate-then-terminal semantics.
- `v2/docs/v1-behaviors.md` — shrink idle escalation aligned with review actuator.

## Prerequisites

- Patch implementation idle-output watchdog escalates through remaining `agentOrder` rungs when a later rung remains
- Shrink resolves agents from `modes.patch.subRoleAgentOrder.reviewActuator` with full-list quota fallback
- Review actuator idle-output watchdog escalates through remaining `reviewActuator` rungs when a later rung remains

## Blocker

- **Review actuator idle-output watchdog escalates through remaining `reviewActuator` rungs when a later rung remains** — not observable in committed code, tests, or docs. `v1/src/modes/patch/review.ts` still sets `idleTimeoutOccurred` and exits `11` on actuator idle stall with no ladder advance; `watchdog-idle-timeout-fallback` appears only in patch implementation (`v1/src/modes/patch/iteration.ts`). Draft spec `v1/spec/2026-07-01T03-40-21Z-review-actuator-idle-escalation/` is unchecked. Merge and implement that spec (or land equivalent behavior) before drafting shrink idle escalation.
