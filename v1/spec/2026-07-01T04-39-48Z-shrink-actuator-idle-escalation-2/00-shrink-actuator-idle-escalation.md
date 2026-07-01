# Shrink actuator idle ladder escalation

## Problem

Patch shrink **idle-output watchdog** stalls (`aborted: idle-timeout`) terminate
the phase with no agent advance while later `reviewActuator` rungs remain
configured — same asymmetry review actuator had before idle escalation shipped.
File-activity liveness can defer idle-fire while `iterationTimeoutMs` runs; that
wall-clock path is out of scope and stays terminal with no cascade.

## Decisions

- **Patch shrink actuator only** — rules out idle cascade for review-panel
  debate roles, review actuator, plan, or prompt phases in this slice.
- **Idle-fire stalls only** — rules out treating `shrink-timeout`
  (`iterationTimeoutMs`) soaks as escalation triggers; only `aborted:
  idle-timeout` with a later rung advances.
- **Ladder from `resolveSubRoleAgentOrder(config, "reviewActuator")`** (pre-override
  config snapshot; unset falls back to `modes.patch.agentOrder`) — rules out a
  separate shrink-only ladder or consuming the `--agent` implementation override
  ladder.
- **Escalation loop inside the shrink invocation** — rules out re-entering the
  completion pipeline or `executeWithQuotaFallback` quota-only advance for idle.
- **Mutable copy of the resolved order; shift stalled rung before retry** — rules
  out same-agent idle retry loops.
- **Each re-spawn gets a fresh idle watchdog and `iterationTimeoutMs` budget**
  (mirror review actuator `continue` semantics).
- **Retry reuses the same shrink prompt**; no second review or implementation
  pass — rules out full completion re-run on idle escalation.
- Deferred to first consumer: extract a shared idle-escalation helper with review
  actuator — pin if duplication blocks a third caller.
- **`opts.agents` injection keyed by current ladder index** — rules out head-only
  binding that breaks multi-rung escalation tests.
- **Escalation stderr `shrink: <agent>: idle timeout; escalating to next agent`**
  (`HARNESS_IDLE_TIMEOUT_FALLBACK` suffix) — rules out bare patch-impl lines or
  `review:` prefix.
- **`[watchdog] idle timeout fired after …` kill diagnostics unchanged** — rules
  out dropping stall visibility at fire time.
- **Non-terminal row: `kind: "timeout"`, `exitReason: "watchdog-idle-timeout-fallback"`;
  terminal row: `exitReason: "watchdog-idle-timeout"`** — rules out losing
  per-rung stall telemetry.
- **Non-terminal idle escalation does not revert worktree changes or elevate run
  exit code** — rules out current discard-on-first-idle behavior during ladder
  walk.
- **Terminal idle abort: process exit `8`** — rules out silent discard (current
  shrink error path) or remapping to review exit `11`.
- **`iterationTimeoutMs` / shrink wall-clock abort stays terminal with no
  cascade** — rules out idle-style ladder advance on iteration timeout.
- **`idleOutputTimeoutMs: 0` disables idle escalation** — rules out
  zero-disable still walking the ladder.
- **Quota fallback semantics unchanged** — full-list `reviewActuator` walk on
  quota; idle escalation is additive.

## Task checklist

- [ ] Wire idle-timeout escalation in patch shrink (`v1/src/modes/patch/shrink.ts`):
  walk remaining `reviewActuator` rungs on idle stall, emit prefixed escalation
  stderr, write fallback telemetry, retry shrink on the next rung; terminal path
  on final rung returns exit `8`.
- [ ] Propagate shrink terminal idle exit `8` through
  `v1/src/modes/patch/completion-pipeline.ts` (mirror review exit propagation).
- [ ] `shrink.sandbox-unrunnable.test.ts`: idle escalation through
  `reviewActuator` when a later rung remains.
- [ ] `shrink.sandbox-unrunnable.test.ts`: final-rung terminal idle (`exit 8`,
  `watchdog-idle-timeout` telemetry).
- [ ] `shrink.sandbox-unrunnable.test.ts`: `idleOutputTimeoutMs: 0` (no
  escalation when disabled).
- [ ] `shrink.sandbox-unrunnable.test.ts`: `iterationTimeoutMs` wall abort
  (terminal, no ladder advance).
- [ ] Update docs listed under Documentation updates.

## Acceptance criteria

- [ ] Shrink idle stall with a later configured `reviewActuator` rung shifts to
  the next agent, emits `shrink: <agent>: idle timeout; escalating to next
  agent`, records `watchdog-idle-timeout-fallback` telemetry (`kind: "timeout"`),
  retries shrink on the next rung, and does not revert worktree changes or
  elevate run exit code for the non-final stall.
- [ ] After non-final shrink idle escalation, a completing later rung finishes
  shrink successfully and the completion pipeline continues (run exit `0` when no
  other failure).
- [ ] Shrink idle stall on the final configured `reviewActuator` rung records
  terminal `watchdog-idle-timeout` telemetry, reverts shrink edits, and the run
  exits `8`.
- [ ] Shrink `iterationTimeoutMs` wall-clock abort (`aborted: shrink-timeout`)
  stays terminal with no ladder advance.
- [ ] Shrink idle escalation ladder uses pre-override
  `resolveSubRoleAgentOrder` snapshot, not `--agent` implementation override.
- [ ] Shrink with `idleOutputTimeoutMs: 0` does not idle-escalate.
- [ ] `shrink.sandbox-unrunnable.test.ts` `"uses full reviewActuator order for
  shrink quota fallback"` stays green (quota full-list unchanged).
- [ ] `review.sandbox-unrunnable.test.ts` `"idle watchdog escalates through
  reviewActuator when fallback rung remains"` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` `"idle watchdog on final
  reviewActuator rung exits 11 with terminal watchdog-idle-timeout"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog escalates through
  agentOrder when fallback rung remains"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog on final rung exits 8
  with terminal watchdog-idle-timeout"` stays green.
- [ ] `v1/docs/agents.md` documents shrink idle escalation (ladder from
  `subRoleAgentOrder.reviewActuator` / `agentOrder`, `shrink:` stderr prefix,
  fallback vs terminal telemetry, terminal exit `8`).
- [ ] `v1/docs/run-loop.md` documents shrink idle escalate-then-terminal
  semantics, contrasts `iterationTimeoutMs` (terminal, no cascade), and records
  shrink terminal idle exit `8`.
- [ ] `v2/docs/v1-behaviors.md` records shrink idle escalation aligned with
  review actuator (full `reviewActuator` ladder walk; terminal stop on final
  rung with exit `8`); review-panel / plan unchanged; quota head-only vs idle
  full-ladder asymmetry note preserved for verdict actuator.

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers shrink actuator; ladder
  source and `shrink:` prefixed stderr; terminal exit `8`.
- `v1/docs/run-loop.md` — shrink idle escalate-then-terminal semantics;
  contrast with `iterationTimeoutMs` (terminal, no cascade); shrink terminal
  idle exit `8`.
- `v2/docs/v1-behaviors.md` — shrink idle escalation + final-rung terminal stop
  (`8`); review-panel / plan unchanged; quota vs idle ladder note for
  `reviewActuator`.
