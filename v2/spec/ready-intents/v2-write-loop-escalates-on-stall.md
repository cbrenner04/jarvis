---
name: v2-write-loop-escalates-on-stall
---

# A stalled v2 invocation escalates to the next binding instead of riding the wall clock

`v2/src/execution/write-loop.ts` arms only `iterationTimeoutMs` (10 min default), so a stalled agent
soaks the wall and terminates with no escalation — the exact failure v1's ladder exists to prevent.

## Behavior

- The write loop supplies the idle-output budget to its invocations.
- A stall advances the binding chain: the stalled rung is abandoned and the next configured binding
  retries the same step, same contract as v1 patch's idle escalation.
- Stall on the final rung is terminal, with an outcome distinguishable from `iteration_timeout`.
- `iterationTimeoutMs` stays terminal with no advance; it cannot distinguish a stalled agent from a
  slow one, which is why it is not the escalation trigger.

## Prerequisites

- shared invocation aborts an invocation that emits no output for its idle budget and classifies it as a stall
- shared invocation advances the binding chain via a per-binding `shouldAdvance` predicate

## Documentation updates

- `v2/docs/write-behavior.md` — the loop's timeout contract: idle budget vs iteration wall, and what advances.
- `v2/docs/operator-runbook.md` § Choosing an actuator — claude as v2 primary now has an escalation path; say what a stall looks like to the operator.
- `v2/docs/v1-behaviors.md` — v1 parity/divergence for stall escalation.
