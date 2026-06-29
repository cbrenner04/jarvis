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
  `no-progress-fallback` / `no-progress` split.
- **Escalation telemetry rows retain existing idle stall fields** (`last_output_age_ms`,
  `last_file_activity_age_ms`, `watchdog_pgid`, `watchdog_descendants_alive` when
  known) — rules out stripping diagnostics on continue.
- **Killed process group and tracked descendants reaped before next rung spawns**
  — rules out orphan leak across ladder advances (reuse existing watchdog kill +
  descendant tracker paths).
- **Run-wide ladder consumption** — rules out resetting `activeAgents` per
  subspec after idle escalation (same semantics as quota / no-progress).

## Task checklist

- [ ] Add `HARNESS_IDLE_TIMEOUT_FALLBACK` constant; wire idle-timeout escalation
  branch in `v1/src/modes/patch/iteration.ts`.
- [ ] On escalation: shift `activeAgents`, emit escalation stderr, write
  `watchdog-idle-timeout-fallback` telemetry, increment iteration, `continue`.
- [ ] On final-rung idle abort: preserve terminal exit `8` path and telemetry.
- [ ] Ensure descendant reaping completes on escalation before next spawn.
- [ ] Sandbox/integration test: head agent hangs silently, next configured agent
  runs the same subspec and run continues (not exit `8`).
- [ ] Sandbox/integration test: idle stall on final rung still exits `8` with
  terminal `watchdog-idle-timeout` telemetry.
- [ ] Update `v1/test/run.sandbox-unrunnable.test.ts` single-agent idle tests only
  where behavior is intentionally unchanged.

## Acceptance criteria

- [ ] When patch implementation idle-output watchdog fires and at least one later
  `modes.patch.agentOrder` rung remains, Jarvis shifts the stalled agent off
  `activeAgents`, emits `<agent>: idle timeout; escalating to next agent` on
  stderr, records a per-rung `watchdog-idle-timeout-fallback` telemetry row,
  increments the iteration counter, and retries the same subspec on the next
  rung.
- [ ] When patch implementation idle-output watchdog fires on the final ladder
  rung, the run terminates exit `8` with a terminal `watchdog-idle-timeout`
  telemetry row (no further agent attempts).
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
- `v1/docs/run-loop.md` — idle-output watchdog: patch iteration
  escalate-then-terminal behavior; explicit contrast with iteration/run wall-clock
  timeouts (still terminal, no cascade).
- `v1/docs/quota-signals.md` — patch telemetry table: add
  `watchdog-idle-timeout-fallback`; update `watchdog-idle-timeout` row for
  terminal-only semantics on patch iteration.
- `v1/docs/operator-runbook.md` — note automatic idle-stall ladder escalation
  during patch implementation; remove or narrow guidance that operators must
  manually switch models or re-run solely to recover from a silent implementation
  stall when fallback rungs remain.
- `v2/docs/v1-behaviors.md` — idle-watchdog bullet: patch iteration idle abort
  escalates through `activeAgents` when fallback rungs remain; terminal exit `8`
  only on final rung; other phases unchanged.
