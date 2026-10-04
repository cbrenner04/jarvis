---
name: idle-output-timeout-default-below-iteration-wall
---

# Idle-output timeout default lands well below the iteration wall

`idleOutputTimeoutMs` defaults to 600000ms, identical to `iterationTimeoutMs`
(`v1/src/config.ts:169-170`, `:339`, `:619`). The idle timer resets on every write, so
reaching 600s of silence requires the iteration to already have burned its full 600s wall
— the wall always fires first. Idle escalation is unreachable under shipped defaults for
every agent. Observed: a claude patch run recorded `last_output_age_ms: 152704` and still
rode the wall to exit 8 with zero completed iterations, no escalation.

Set the default to 90000ms (90s): long enough that a slow-thinking agent pausing
between tool calls isn't mistaken for a stall, short enough to catch a wedged agent well
before the 600s wall. Fix the default, not the wall — raising `iterationTimeoutMs` would
slow every real stall. Update the four sites that hardcode `600000` as the idle fallback
(`config.ts`, `modes/plan/draft.ts`, `modes/plan/review.ts`, `modes/plan/verdict-actuator.ts`)
so the default lives in one place.

Regression coverage: with default config (no explicit idle threshold), an agent that goes
silent past the idle threshold while the iteration wall still has time left must escalate
to the next `modes.patch.agentOrder` rung. Existing tests drive the watchdog with an
explicit low threshold and therefore never exercise the default.

Out of scope: the `iterationTimeoutMs` default; idle detection for
`subRoleAgentOrder.reviewActuator`.

## Documentation updates

- `v1/docs/config.md` — document both timeouts, their relationship, and that the idle
  threshold is a stall heuristic chosen from observed inter-output gaps, not a
  performance budget.
- `v1/docs/operator-runbook.md` — the Manual-finalize recovery section describes idle
  escalation as a live mechanism; correct it now that it actually is.

## Prerequisites
