# The idle-output watchdog can never fire: its default equals the iteration wall

`idleOutputTimeoutMs` defaults to 600000ms — the same 600000ms as
`iterationTimeoutMs`. An agent must be silent for a full 10 minutes to trip the idle
watchdog, but by then the iteration has already burned 10 minutes of wall clock and
the hard timeout has fired. **Idle escalation is unreachable with the shipped
defaults**, for every agent.

## Problem

Verified on `main` 2026-07-13.

```
v1/src/config.ts:333   obj.iterationTimeoutMs  ?? DEFAULT_CONFIG.iterationTimeoutMs   // 600000
v1/src/config.ts:339   obj.idleOutputTimeoutMs ?? 600000
```

The operator's live `~/.jarvis/config.json` sets `iterationTimeoutMs: 600000` and
leaves `idleOutputTimeoutMs` unset, so both are 600000.

- The iteration wall clock counts **from iteration start**.
- The idle timer counts **from the last output**, resetting on every write.

For the idle timer to reach 600s, the process must have been running at least 600s —
at which point the iteration wall has already tripped. The two can only ever fire
simultaneously, and the wall wins. The idle ladder is dead code in practice.

The runbook documents idle escalation as a live mechanism —
"an idle-output stall (no stdout/stderr and no file activity for `idleOutputTimeoutMs`)
auto-escalates through `modes.patch.agentOrder`" — and it has, as far as the defaults
go, never once run.

## How it surfaced

Immediately after #1450 (`claude-streams-output-to-watchdog`) made claude's stdout
observable for the first time, a claude patch run on
`write-loop-reprompts-once-for-missing-token` recorded:

```json
{"exit_reason":"watchdog-iteration-timeout","last_output_age_ms":152704,"iteration":1}
```

The watchdog **saw** 152 seconds of silence — real, measurable, exactly the signal
idle escalation exists to act on — and still let the run ride the full 10-minute wall
to exit 8 with zero completed iterations, because 152s < 600s. The agent was never
escalated. That run produced nothing and cost a full wall clock.

Before #1450 this was invisible; the field was always `null` for claude. Fixing the
observation exposed that nothing consumes it.

## Scope

- Pick an `idleOutputTimeoutMs` default that is meaningfully **below**
  `iterationTimeoutMs`, so a stalled agent escalates in tens of seconds rather than
  burning the full wall.
- A configuration where `idleOutputTimeoutMs >= iterationTimeoutMs` is incoherent —
  it silently disables idle escalation. Reject or warn on it at config load rather
  than accepting a config whose ladder can never run.
- Regression coverage: an agent that goes silent past the idle threshold, while the
  iteration wall still has time left, must escalate to the next `agentOrder` rung.
  Existing tests presumably drive the idle watchdog with an explicit low threshold and
  therefore never caught that the *default* makes it unreachable.

## Decisions

- Fix the default, not the wall. Raising `iterationTimeoutMs` to make room for idle
  would make every real stall slower to catch.
- Idle escalation only becomes useful once output is observable for the agent in
  question — this seed is the companion to `patch-watchdog-blind-to-claude-output`
  (#1450, shipped). Landing one without the other leaves the ladder dead.
- The threshold is a stall heuristic, not a performance budget: it should tolerate a
  slow-thinking agent between tool calls but not a wedged one. Choose it from observed
  inter-output gaps, and say so in the config docs.

## Out of scope

- The `iterationTimeoutMs` default (10 min).
- Idle detection for the *review* actuator ladder (`subRoleAgentOrder.reviewActuator`)
  — same defect, but land the patch ladder first and confirm.

## Documentation updates

- `v1/docs/config.md` — document both timeouts, their relationship, and the constraint
  that idle must be strictly less than the iteration wall.
- `v1/docs/operator-runbook.md` — the [Manual-finalize recovery](../../v1/docs/operator-runbook.md#manual-finalize-recovery-last-resort-path)
  section describes idle escalation as working. Correct it, or delete the caveat once
  this ships.
