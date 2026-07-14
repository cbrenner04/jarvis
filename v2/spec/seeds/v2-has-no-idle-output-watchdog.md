# v2 has no idle-output watchdog — not a blind one, none at all

v1's escalation ladder rests on an idle-output watchdog: an agent that emits nothing for
`idleOutputTimeoutMs` is aborted and the run escalates to the next rung of `agentOrder`. **v2 has
no such watchdog.** `v2/src/execution/write-loop.ts` arms only a wall-clock `iterationTimeoutMs`,
and `InvocationCompletedRecord` has no output-age field to arm one from.

## Problem

Surfaced 2026-07-13 by the plan agent for `shared-invocation-claude-stream-json`, which refused
to accept its intent's second decision ("stream events bump the watchdog's last-output timestamp;
a v2 claude invocation records a non-null `last_output_age_ms`") because neither the watchdog nor
the field exists.

The consequence is that a stalled v2 agent rides `iterationTimeoutMs` (10 min default) to a
terminal timeout with **no escalation** — the exact failure v1's ladder exists to prevent. It
also means the `claude-streams-output-to-watchdog` framing does not transfer: #1509 shipped the
*prerequisite* (claude's output now arrives incrementally in `shared/invocation` rather than as
one batch envelope at exit), but nothing consumes it.

Note this reframes the seed that produced #1509. Its stated harm — "the idle-output watchdog is
structurally blind to claude in v2" — was half wrong: there was no watchdog to be blind. The cost
half was exactly right and is fixed.

## Decisions

- **A v2 invocation that emits no output for `idleOutputTimeoutMs` is aborted and escalates**
  through the configured agent order, same contract as v1 patch. Rules out relying on
  `iterationTimeoutMs` alone, which cannot distinguish a stalled agent from a slow one.
- **The output-age measurement is recorded**, so "we measured nothing" is distinguishable from
  "the agent produced nothing" — the confusion that produced two wrong diagnoses in v1
  (`zero-output-iteration-is-a-harness-defect`).
- Build it on `shared/invocation`, so v1 and v2 share one watchdog rather than growing a second.

## Prerequisites

- #1509 (claude streams incrementally through `shared/invocation`). Shipped.

## Out of scope

- Cursor's partial unobservability (`cursor-streams-tool-activity`) — a working watchdog would
  kill cursor, so that seed should land alongside or before this one.

## Documentation updates

- `v2/docs/operator-runbook.md` § Choosing an actuator — the claim that claude is safe as v2
  primary rests on an escalation path that does not exist yet. State this plainly until it ships.
- `v2/docs/write-behavior.md` — the loop's timeout contract.
