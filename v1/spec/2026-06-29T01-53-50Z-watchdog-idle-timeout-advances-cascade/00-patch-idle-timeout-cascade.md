# Patch idle-timeout ladder escalation

## Problem

Patch implementation idle-output watchdog kills a silent agent and immediately
terminates the run (exit `8`, `watchdog-idle-timeout`) even when later
`modes.patch.agentOrder` rungs remain. Quota and no-progress already shift
`activeAgents` and retry the same subspec; idle stalls should not be a dead end
while a fallback rung exists.

## Decisions

- **Patch implementation iteration only** — rules out idle-timeout cascade in
  review, shrink, plan, or prompt phases (those stay terminal on idle abort).
- **Escalation mirrors no-progress ladder mechanics** (`activeAgents.shift()`,
  same subspec, `state.iteration += 1`, `kind: "continue"`) — rules out a
  parallel fallback list or same-iteration hidden retry.
- **Fix-up iteration: terminal exit `8`, no ladder escalation** — rules out
  idle cascade during ready-fix iterations (parity with no-progress
  `!isFixupIteration` guard).
- **Escalation skips `captureInterruptedDelta`** — rules out persisting
  interrupted delta when run continues (parity with no-progress escalation);
  terminal idle abort keeps existing call.
- **Final rung idle abort stays terminal exit `8`** — rules out same-agent idle
  retry loops.
- **`iterationTimeoutMs` / `watchdog-iteration-timeout` and `runTimeoutMs` /
  `run-timeout` stay terminal** — rules out timeout-class-wide cascade.
- **Stderr escalation line `<agent>: idle timeout; escalating to next agent`**
  (canonical constant in `quota-harness-messages.ts`) — rules out quota or
  no-progress phrasing.
- **`[watchdog] idle timeout fired after …` kill diagnostics unchanged** —
  rules out dropping stall visibility at fire time.
- **Harness `iteration N exceeded idle timeout` line only on terminal idle
  stop** — rules out duplicate escalation stderr on continue paths.
- **Telemetry: `kind: "timeout"` with `exitReason: "watchdog-idle-timeout-fallback"`
  on escalation; terminal row keeps `exitReason: "watchdog-idle-timeout"`** —
  rules out losing per-rung stall rows when the run continues; mirrors
  `no-progress-fallback` / `no-progress` split; `watchdog-idle-timeout-fallback`
  is non-terminal despite `kind: "timeout"`.
- **Escalation telemetry rows carry the same meta/diagnostic field set as
  terminal idle rows** (`telemetryMeta` spread or equivalent, including
  `configured_model`, plus stall fields `last_output_age_ms`,
  `last_file_activity_age_ms`, `watchdog_pgid`, `watchdog_descendants_alive`
  when known) — rules out stripping diagnostics on continue.
- **Killed process group and tracked descendants reaped before next rung spawns**
  — rules out orphan leak across ladder advances (reuse existing watchdog kill +
  descendant tracker paths).
- **Run-wide ladder consumption** — rules out resetting `activeAgents` per
  subspec after idle escalation (same semantics as quota / no-progress).

## Task checklist

- [ ] Add `HARNESS_IDLE_TIMEOUT_FALLBACK` constant; wire idle-timeout escalation
  branch in `v1/src/modes/patch/iteration.ts` with `isFixupIteration` guard.
- [ ] On escalation: shift `activeAgents`, emit escalation stderr, write
  `watchdog-idle-timeout-fallback` telemetry (full field set), increment
  iteration, `continue`; skip `captureInterruptedDelta`.
- [ ] On final-rung or fix-up idle abort: preserve terminal exit `8` path,
  `captureInterruptedDelta`, and terminal telemetry.
- [ ] Ensure descendant reaping completes on escalation before next spawn.
- [ ] `run.sandbox-unrunnable.test.ts`: add `idle watchdog escalates through
  agentOrder when fallback rung remains`.
- [ ] `run.sandbox-unrunnable.test.ts`: add `idle watchdog on final rung exits 8
  with terminal watchdog-idle-timeout`.
- [ ] Update `v1/test/run.sandbox-unrunnable.test.ts` single-agent idle tests only
  where behavior is intentionally unchanged.

## Acceptance criteria

- [ ] `run.sandbox-unrunnable.test.ts` `idle watchdog escalates through
  agentOrder when fallback rung remains` passes (shifts stalled agent,
  `<agent>: idle timeout; escalating to next agent` stderr,
  `watchdog-idle-timeout-fallback` telemetry, same subspec on next rung, run
  continues).
- [ ] `run.sandbox-unrunnable.test.ts` `idle watchdog on final rung exits 8
  with terminal watchdog-idle-timeout` passes.
- [ ] `run.sandbox-unrunnable.test.ts` single-agent idle-watchdog tests stay
  green (terminal exit `8` behavior unchanged when no fallback rung exists).
- [ ] `modes/patch/review.sandbox-unrunnable.test.ts` and
  `modes/patch/shrink.sandbox-unrunnable.test.ts` idle-watchdog tests stay green
  (review/shrink idle abort remains terminal, no cascade).
- [ ] Per-iteration wall-clock timeout and whole-run timeout paths remain
  terminal with no agent cascade (`run.sandbox-unrunnable.test.ts` iteration-
  timeout coverage stays green).

## Documentation updates

- `v1/docs/agents.md` — `agentOrder as an escalation ladder`: idle-timeout as a
  third patch escalation trigger alongside quota and no-progress; shared ladder
  and run-wide semantics.
- `v1/docs/run-loop.md` — exit `8` table row and idle-output watchdog section:
  patch iteration escalate-then-terminal behavior; explicit contrast with
  iteration/run wall-clock timeouts (still terminal, no cascade).
- `v1/docs/workflows.md` — implementation-loop diagram: idle escalate-then-
  terminal edges; no-progress ladder edges (not straight to exit `4`).
- `v1/docs/quota-signals.md` — patch telemetry table: add
  `watchdog-idle-timeout-fallback` (non-terminal despite `kind: "timeout"`);
  update `watchdog-idle-timeout` row for terminal-only semantics on patch
  iteration.
- `v1/docs/operator-runbook.md` — add short note that patch-implementation idle
  stalls auto-escalate through `agentOrder` when fallback rungs remain.
- `v2/docs/v1-behaviors.md` — idle-watchdog bullet: patch iteration idle abort
  escalates through `activeAgents` when fallback rungs remain; terminal exit `8`
  only on final rung; other phases unchanged.
- `v2/docs/outcome-data-source-audit.md` — add `watchdog-idle-timeout-fallback`
  as non-terminal per-rung row (same class as `no-progress-fallback`); note
  escalation `kind: "timeout"` vs terminal `watchdog-idle-timeout`; final
  identity-bound row drives run-level outcome hints.
