# Review actuator idle ladder escalation

## Problem

Patch review verdict actuator **idle-output watchdog** stalls (`aborted:
idle-timeout`) terminate the phase with no agent advance while later
`reviewActuator` rungs remain configured. File-activity liveness can defer
idle-fire while `iterationTimeoutMs` runs; that wall-clock path is out of scope
and stays terminal with no cascade.

**Intent note:** `intent.md` pins final-rung exit `8`; committed review
semantics use process exit `11` with `watchdog-idle-timeout` telemetry — spec
wins on merge.

## Decisions

- **Patch review actuator only** — rules out idle cascade for review-panel
  debate roles, shrink, plan, or prompt phases in this slice.
- **Idle-fire stalls only** — rules out treating iteration-wall soaks as
  escalation triggers; only `aborted: idle-timeout` with a later rung advances.
- **Ladder from `resolveSubRoleAgentOrder(config, "reviewActuator")`** (pre-override
  config snapshot; unset falls back to `modes.patch.agentOrder`) — rules out
  consuming the `--agent` implementation override ladder.
- **Escalation loop inside the actuator binding** — rules out re-entering the
  full review pass on idle stall.
- **Mutable copy of the resolved order; shift stalled rung before retry** — rules
  out same-agent idle retry loops.
- **Each re-spawn gets a fresh idle watchdog and `iterationTimeoutMs` budget**
  (patch `continue` semantics).
- **Retry reuses the same verdict application** (same on-disk verdict + actuator
  prompt); no second adjudicator pass — rules out full review re-run on idle
  escalation.
- Deferred to first consumer: whether the retried spawn re-reads on-disk verdict
  bytes vs reuses the in-memory prompt — pin at escalation call-site.
- **`actuatorAgents` parallel array indexed by rung** — test injection slot `i`
  substitutes the agent for ladder index `i`; unset slot falls through to config
  `opts.agents` — rules out head-only `[0]` binding that breaks multi-rung
  escalation tests.
- **Escalation stderr `review: <agent>: idle timeout; escalating to next agent`**
  (`HARNESS_IDLE_TIMEOUT_FALLBACK` suffix) — rules out bare patch-impl lines
  without phase prefix.
- **`[watchdog] idle timeout fired after …` kill diagnostics unchanged** — rules
  out dropping stall visibility at fire time.
- **Non-terminal row: `kind: "timeout"`, `exitReason: "watchdog-idle-timeout-fallback"`;
  terminal row: `exitReason: "watchdog-idle-timeout"`** — rules out losing
  per-rung stall telemetry.
- **Non-terminal fallback does not set `idleTimeoutOccurred` and does not throw
  `ReviewTerminalError` for idle** — rules out arming exit `11` on fallback rows.
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
  application; preserve terminal path on final rung; fix stale “maps to exit 8”
  comment in the idle block.
- [ ] On escalation: skip throwing `ReviewTerminalError`; do not set
  `idleTimeoutOccurred`; set `watchdog-idle-timeout-fallback` on the per-rung
  row; continue the actuator loop. On final-rung idle: set
  `idleTimeoutOccurred` → exit `11` and terminal `watchdog-idle-timeout`
  telemetry.
- [ ] Index `actuatorAgents` by current ladder rung (parallel array); update
  existing single-rung call sites.
- [ ] `review.sandbox-unrunnable.test.ts`: add idle escalation through
  `reviewActuator` when a later rung remains (multi-rung `actuatorAgents`).
- [ ] `review.sandbox-unrunnable.test.ts`: add or extend final-rung terminal idle
  coverage for multi-rung order.
- [ ] `review.sandbox-unrunnable.test.ts`: add review actuator
  `idleOutputTimeoutMs: 0` coverage (no escalation when disabled).
- [ ] `review.sandbox-unrunnable.test.ts`: add or extend iteration-wall abort
  coverage (terminal, no ladder advance).
- [ ] Update docs listed under Documentation updates.

## Acceptance criteria

- [x] Review actuator idle stall with a later configured `reviewActuator` rung
  shifts to the next agent, emits `review: <agent>: idle timeout; escalating to
  next agent`, records `watchdog-idle-timeout-fallback` telemetry, retries verdict
  application on the next rung, and does not set `idleTimeoutOccurred` or throw
  `ReviewTerminalError` for the non-final stall.
- [x] After non-final idle escalation, a completing later rung finishes verdict
  application and the review phase exits `0` (or otherwise continues past the
  actuator).
- [x] Review actuator idle stall on the final configured rung records terminal
  `watchdog-idle-timeout` telemetry, sets `idleTimeoutOccurred`, and exits `11`.
- [x] Review actuator `iterationTimeoutMs` wall-clock abort stays terminal with
  no ladder advance (idle-fire escalation does not apply).
- [x] Review actuator idle escalation ladder uses pre-override
  `resolveSubRoleAgentOrder` snapshot, not `--agent` implementation override.
- [x] Review actuator with `idleOutputTimeoutMs: 0` does not idle-escalate.
- [x] `review.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in review
  actuator phase"` stays green (single-rung terminal `11` unchanged).
- [x] `review.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in review
  debate phase"` stays green (debate idle abort remains terminal, no cascade).
- [x] `modes/patch/shrink.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires
  in shrink phase"` stays green (shrink idle abort remains terminal, no cascade).
- [x] `run.sandbox-unrunnable.test.ts` `"idle watchdog escalates through agentOrder
  when fallback rung remains"` stays green.
- [x] `run.sandbox-unrunnable.test.ts` `"idle watchdog on final rung exits 8 with
  terminal watchdog-idle-timeout"` stays green.
- [x] `run.sandbox-unrunnable.test.ts` `"idle abort is not classified as quota and
  escalates via idle ladder"` stays green.
- [x] `run.test.ts` `"review and shrink use pre-override patch order without
  subRoleAgentOrder"` stays green.
- [x] `v1/docs/agents.md` documents review actuator idle escalation (ladder from
  `subRoleAgentOrder.reviewActuator` / `agentOrder`, `review:` stderr prefix,
  fallback vs terminal telemetry); patch-implementation section unchanged except
  cross-reference.
- [x] `v1/docs/quota-signals.md` documents review actuator
  `watchdog-idle-timeout-fallback` rows and reconciles review terminal idle to
  process exit `11` (not `8`) with `exitReason: "watchdog-idle-timeout"`.
- [x] `v1/docs/run-loop.md` documents review actuator idle escalate-then-terminal
  semantics, contrasts `iterationTimeoutMs` (terminal, no cascade), and
  reconciles review terminal idle to exit `11` (not `8`).
- [x] `v1/docs/operator-runbook.md` documents review actuator idle-fire auto-
  escalation through configured rungs; removes “wait out the 30-min wall”
  guidance for idle stalls (iteration wall remains terminal).
- [x] `v2/docs/v1-behaviors.md` records review-actuator idle escalation +
  final-rung terminal stop (`11`); shrink / review-panel / plan unchanged;
  notes quota head-only vs idle full-ladder asymmetry for `reviewActuator`.

## Documentation updates

- `v1/docs/agents.md` — idle-timeout escalation covers review actuator (not
  patch-implementation only); ladder source and prefixed stderr.
- `v1/docs/quota-signals.md` — idle-timeout escalation section covers review
  actuator fallback rows; reconcile review terminal idle exit `11`.
- `v1/docs/run-loop.md` — review actuator idle escalate-then-terminal semantics;
  contrast with `iterationTimeoutMs` (terminal, no cascade); reconcile exit `11`.
- `v1/docs/operator-runbook.md` — review actuator idle-fire auto-escalates
  through configured rungs; drop 30-min soak observation for idle stalls only.
- `v2/docs/v1-behaviors.md` — review-actuator idle escalation + final-rung
  terminal stop; shrink/plan/review-panel unchanged; quota vs idle ladder note.
