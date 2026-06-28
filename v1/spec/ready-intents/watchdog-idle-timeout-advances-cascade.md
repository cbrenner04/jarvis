---
name: watchdog-idle-timeout-advances-cascade
---

# Watchdog idle-timeout advances the agent cascade

When a patch implementation agent is killed by the idle-output watchdog, Jarvis should treat that rung like no-progress: tear it down, shift it off `activeAgents`, and retry the same subspec on the next configured agent at the next iteration number. A single hung or silent agent should not end the run while a fallback rung remains.

## Decisions

- Idle-output timeout escalates when a fallback rung remains; rules out exit `8` on the first silent stall.
- Final-rung idle-output timeout remains terminal exit `8`; rules out an unbounded same-agent retry loop.
- Overall iteration timeout and whole-run timeout remain terminal; rules out applying this cascade behavior to every timeout class.
- Idle-timeout escalation advances to the next iteration number; rules out a hidden retry that bypasses `maxIterations` accounting.
- The killed agent process group and tracked descendants are reaped before spawning the next rung; rules out leaking the stalled process.
- Stderr emits `<agent>: idle timeout; escalating to next agent`; rules out reusing quota or no-progress fallback wording.
- Telemetry preserves a per-rung `watchdog-idle-timeout` record with escalation vs terminal outcome; rules out losing stall visibility when the run continues.

## Documentation updates

- `v1/docs/agents.md` documents idle-timeout as a patch ladder escalation trigger.
- `v1/docs/run-loop.md` documents idle-timeout escalate-then-terminal behavior and distinguishes iteration/run timeouts.
- `v1/docs/operator-runbook.md` removes or narrows the manual switch-models workaround for agent stalls.
- `v2/docs/v1-behaviors.md` records the new v1 cascade behavior.

## Prerequisites

- Patch mode has a finite `modes.patch.agentOrder` ladder that advances on quota and no-progress.
- Patch idle-output watchdog detects no-output/no-file-activity stalls and kills the active agent.
- Patch telemetry records watchdog idle-timeout rows.
