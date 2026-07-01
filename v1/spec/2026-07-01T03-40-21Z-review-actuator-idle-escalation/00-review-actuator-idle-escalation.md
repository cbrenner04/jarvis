# Review actuator idle ladder escalation

## Problem

Patch review verdict actuator idle-output stalls terminate the phase (or soak
`iterationTimeoutMs`) with no agent advance while later
`reviewActuator` rungs remain configured.

## Decisions

- **Patch review actuator only** — rules out idle cascade for review-panel
  debate roles, shrink, plan, or prompt phases in this slice.
- **Ladder from `resolveSubRoleAgentOrder(config, "reviewActuator")`** (pre-override
  config snapshot; unset falls back to `modes.patch.agentOrder`) — rules out
  consuming the `--agent` override ladder.
- **Escalation loop inside the actuator binding** — rules out re-entering the
  full review pass on idle stall.
- **Mutable copy of the resolved order; shift stalled rung before retry** — rules
  out same-agent idle retry loops.
- **Retry reuses the same verdict application** (same on-disk verdict + actuator
  prompt); no second adjudicator pass — rules out full review re-run on idle
  escalation.
- Deferred to first consumer: whether the retried spawn re-reads on-disk verdict
  bytes vs reuses the in-memory prompt — pin at escalation call-site.
- **Escalation stderr `review: <agent>: idle timeout; escalating to next agent`**
  (`HARNESS_IDLE_TIMEOUT_FALLBACK` suffix) — rules out bare patch-impl lines
  without phase prefix.
- **`[watchdog] idle timeout fired after …` kill diagnostics unchanged** — rules
  out dropping stall visibility at fire time.
- **Non-terminal row: `kind: "timeout"`, `exitReason: "watchdog-idle-timeout-fallback"`;
  terminal row: `exitReason: "watchdog-idle-timeout"`** — rules out losing
  per-rung stall telemetry.
- **Terminal idle abort: process exit `11` (review-incomplete)** — rules out
  remapping review idle to process exit `8`.
- **`iterationTimeoutMs` / actuator wall-clock abort stays terminal with no
  cascade** — rules out idle-style ladder advance on iteration timeout.
- **Killed process group and tracked descendants reaped before next rung spawns**
  — rules out orphan leak across ladder advances.

## Task checklist

- [ ] Wire idle-timeout escalation in the patch review actuator binding
  (`v1/src/modes/patch/review.ts`): shift remaining `reviewActuator` rungs,
  emit prefixed escalation stderr, write fallback telemetry, retry verdict
  application; preserve terminal path on final rung.
- [ ] On escalation: skip throwing `ReviewTerminalError`; set
  `watchdog-idle-timeout-fallback` on the per-rung row; continue the actuator
  loop. On final-rung idle: preserve `idleTimeoutOccurred` → exit `11` path and
  terminal `watchdog-idle-timeout` telemetry.
- [ ] `review.sandbox-unrunnable.test.ts`: add idle escalation through
  `reviewActuator` when a later rung remains.
- [ ] `review.sandbox-unrunnable.test.ts`: add or extend final-rung terminal idle
  coverage for multi-rung order.

## Acceptance criteria

- [ ] Review actuator idle stall with a later configured `reviewActuator` rung
  shifts to the next agent, emits `review: <agent>: idle timeout; escalating to
  next agent`, records `watchdog-idle-timeout-fallback` telemetry, retries verdict
  application on the next rung, and the review phase continues (does not exit
  `11` solely from the non-final stall).
- [ ] Review actuator idle stall on the final configured rung records terminal
  `watchdog-idle-timeout` telemetry and exits `11`.
- [ ] `review.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in review
  debate phase"` stays green (debate idle abort remains terminal, no cascade).
- [ ] `modes/patch/shrink.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires
  in shrink phase"` stays green (shrink idle abort remains terminal, no cascade).
- [ ] `run.sandbox-unrunnable.test.ts` patch-implementation idle escalation tests
  stay green (implementation idle ladder unchanged).

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers review actuator (not
  patch-implementation only); ladder source and prefixed stderr.
- `v1/docs/quota-signals.md` — idle-timeout escalation section covers review
  actuator fallback rows.
- `v1/docs/run-loop.md` — review actuator idle escalate-then-terminal semantics;
  contrast with `iterationTimeoutMs` (terminal, no cascade).
- `v1/docs/operator-runbook.md` — review actuator idle stall auto-escalates
  through configured rungs; drop 30-min soak observation.
- `v2/docs/v1-behaviors.md` — review-actuator idle escalation + final-rung
  terminal stop; shrink/plan/review-panel unchanged.
