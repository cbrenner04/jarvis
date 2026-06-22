---
name: escalate-actuator-on-no-progress
---

# Auto-advance the agent on a no-progress stop instead of exiting

## Problem

A no-progress stop in patch mode exits the run (exit 4); the operator then manually bumps the model
and re-runs. The cheapest actuator routinely no-progress-stalls on non-trivial actuation, so recovery
is pure operator toil. Today `agentOrder` advances to the next agent only on quota signals, not on
no-progress.

## Decision

On a no-progress stop, advance to the next `agentOrder` entry (`activeAgents.shift()`) and retry the
iteration, exactly as quota fallback already does. Return exit 4 only once the ladder is exhausted
(the last rung also no-progressed). `agentOrder` doubles as the escalation ladder — reuses existing
config, no new schema.

Bounded: advance through the order at most once per spec (the natural consequence of shifting a finite
`activeAgents`).

Accepted tradeoff: advancing `agentOrder` changes agent and model together; the operator steers it by
ordering the list cheap→strong. A dedicated strength-only ladder is a follow-on if the cross-agent jump
proves wrong.

Out of scope (staged follow-ons, do not implement here): difficulty score for the starting rung;
escalating on other deterministic failures (nonzero exit, gate-fail); per-sub-role model granularity;
dedicated strength-only ladder.

## Prerequisites

- Quota fallback advances through `agentOrder` via `activeAgents.shift()` and retries the iteration.

## Documentation updates

- `v1/docs/agents.md` — `agentOrder` now advances on no-progress too; document it as an escalation ladder (order cheap→strong) and the agent+model coupling.
- `v1/docs/quota-signals.md` and/or `v1/docs/run-loop.md` — no-progress now escalates before exiting.
- `v2/docs/v1-behaviors.md` — patch run-loop change: no-progress is no longer an immediate exit-4.
