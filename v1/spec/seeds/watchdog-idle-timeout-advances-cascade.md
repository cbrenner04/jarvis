---
name: watchdog-idle-timeout-advances-cascade
---

# Watchdog idle-timeout advances the agent cascade instead of killing the run

When the patch-iteration watchdog fires an **idle timeout** (no agent output for
`iterationTimeoutMs`), the harness kills the agent and ends the whole run with
exit `8` (`timeout`). It does **not** fall back to the next agent in
`modes.patch.agentOrder`, even when a healthy fallback rung is available. A
single stalling agent therefore aborts a run that the next agent could finish.

## Problem

A rate-limited or hung agent that stops emitting output (e.g. `cursor`/Composer
under load) trips the 10-minute idle watchdog. Today that is **terminal**: the
run exits `8`, the operator must notice, switch models, and re-run — burning the
full watchdog window per stall (observed 2026-06-27: two separate runs each lost
16–27 min to cursor idle-timeouts while `claude` sat available as the next rung).

The cascade already advances on two non-fatal signals — **quota** and
**no-progress** (`v1/docs/agents.md`). An idle-timeout is the same class of event:
"this rung isn't producing; try the next one." But it's wired as a hard failure
instead of an escalation.

## Decisions

- A watchdog **idle-timeout** advances the agent cascade (shift the current rung,
  retry the same subspec on the next agent at the next iteration number) when a
  fallback rung remains — mirroring no-progress escalation; rules out terminating
  the run on the first stall when fallbacks exist.
- Only when the **last** rung idle-times-out does the run exit `8` (timeout) —
  the cascade is finite, so escalation is bounded, not an infinite retry loop.
- A distinct stderr line (`<agent>: idle timeout; escalating to next agent`)
  separates it from quota- and no-progress-fallback lines — rules out silent
  reclassification.
- The killed agent's process group is still torn down (existing watchdog kill +
  orphan reaping) before the next rung spawns — rules out leaking the stalled
  process.
- Telemetry records the idle-timeout escalation per rung (existing
  `watchdog-idle-timeout` rows gain the escalation outcome) — rules out losing the
  per-rung stall signal.

## Open for refine

- Whether the **hard** (overall) iteration timeout vs the **idle** (no-output)
  timeout should be treated differently — idle clearly escalates; a hard cap may
  still be terminal. Pin which timeout(s) this applies to.
- Whether to count an idle-timeout escalation against `maxIterations` the same way
  no-progress does (it currently increments the iteration counter).

## Documentation updates

- `v1/docs/agents.md` — add idle-timeout to the cascade escalation triggers
  (alongside quota and no-progress).
- `v1/docs/run-loop.md` — watchdog section: escalate-then-terminal behavior.
- `v1/docs/operator-runbook.md` — the "switch models when an agent stalls" manual
  workaround can be dropped once this ships (cleanup trigger).
- `v2/docs/v1-behaviors.md` — record the cascade idle-timeout escalation.

## Prerequisites

- Patch agent cascade already escalates on quota and no-progress signals.
- Watchdog idle-timeout already detects no-output stalls and kills the agent.
