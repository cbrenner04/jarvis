# Shrink onto shared executor

## Problem

`runPatchShrinkPhase` in `v1/src/modes/patch/shrink.ts` (`shrink.ts:395-561`)
hand-rolls a `for` loop over `reviewActuatorOrder`, calling
`applyQuotaFallbackWhenAllowed` directly instead of going through
`executeWithQuotaFallback`. A ready-made binding for this already exists and is
currently unused: `createShrinkInvocationBinding`
(`v1/src/modes/patch/shrink-invocation-binding.ts`) already wraps agent
spawn + `applyQuotaFallbackWhenAllowed` classification as an
`InvocationBinding`, but nothing calls it. On inspection this loop already
falls through correctly on quota (no live bug), but it duplicates the same
control flow as the review actuator and plan's verdict actuator.

## Decisions

- Rung iteration moves onto `executeWithQuotaFallback`, with one binding per
  `reviewActuatorOrder` entry built via `createShrinkInvocationBinding` — reuses
  the existing, already-tested wrapper rather than writing a second one, ruling
  out hand-rolling classification again.
- Bindings set an explicit `shouldAdvance` covering `kind === "quota"` and
  `kind === "error" && stderr.includes("aborted: idle-timeout")`, matching the
  review-actuator subspec's reasoning: the executor's `quota`-only default
  would make idle-timeout terminal on the first rung.
- `model_config` stays outside `shouldAdvance` (terminal, discards and returns
  — unchanged).
- Per-rung side effects that must survive the move: `writeRung` telemetry calls
  (`ok`, `quota-fallback`/`quota-exhausted`, `model_config`, `agent-error`,
  `timeout`, `watchdog-idle-timeout-fallback`, `watchdog-idle-timeout`), the
  auth-rotate-vs-strict-quota and lenient-quota stderr line selection, and
  `revertAllSince(preShrinkHead)` on every non-`ok` terminal path. These move
  into per-attempt callbacks (`onQuotaFallbackEmit`/`recordAttempt` already
  supported by `createShrinkInvocationBinding`) and a post-execution handler
  keyed on `execution.final`, not into the shared executor.
- Idle watchdog wiring (timer, `AbortController`, `lastOutputAtMs`) stays
  per-rung as today — idle-timeout mechanics are out of scope; only the
  loop/fallback shell converges.
- Successful rung result (`kind === "ok"`) and its originating `agent`/
  `configuredModel` must remain available after the executor call for the
  existing post-success pipeline (out-of-scope revert, spec-tree revert,
  contract validation, commit) — read these off `execution.final`.

## Task Checklist

- [ ] Replace the `for (let rungIndex ...)` loop with one
      `executeWithQuotaFallback` call over bindings built from
      `createShrinkInvocationBinding` per `reviewActuatorOrder` entry.
- [ ] Wire `shouldAdvance` per binding per the Decisions above.
- [ ] Wire `onQuotaFallbackEmit` to reproduce the existing auth-rotate /
      strict-quota / lenient-quota stderr line selection unchanged.
- [ ] Wire `recordAttempt` (or a post-execution pass over
      `execution.attempts`) to reproduce the existing `writeRung` telemetry
      rows unchanged (same `kind`/`exitReason` values per outcome).
- [ ] Move the terminal handling (final-rung quota exhausted, `model_config`,
      final-rung idle timeout, other agent errors) into a handler keyed on
      `execution.final`, preserving existing `revertAllSince` calls,
      `ShrinkTerminalError` (exit `8`), and early-return semantics.
- [ ] Preserve the success path unchanged: `result`/`successfulAgent` populated
      from `execution.final` feed the existing post-loop pipeline
      (out-of-scope revert → spec-tree revert → contract validation → commit)
      without modification.

## Acceptance criteria

- [ ] `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` stays green
      (behavior unchanged by the refactor), specifically: `uses full
      reviewActuator order for shrink quota fallback`, `idle watchdog timeout
      fires in shrink phase`, `emits auth note on auth failure in shrink quota
      rotation`, `emits quota line (not auth note) on plain quota in shrink
      rotation`, `idle watchdog escalates through reviewActuator when fallback
      rung remains`, `non-final idle escalation retains partial shrink edits
      for next rung`, `terminal idle reverts shrink edits to preShrinkHead`,
      `shrink does not idle-escalate on idle-timeout stderr without error
      kind`, `idle watchdog on final reviewActuator rung exits 8 with terminal
      watchdog-idle-timeout`, `shrink with idleOutputTimeoutMs 0 does not
      idle-escalate`.
- [ ] `runPatchShrinkPhase`'s rung loop calls `executeWithQuotaFallback`
      (`shared/invocation/execute.ts`) via `createShrinkInvocationBinding`
      instead of a hand-rolled `for` loop calling
      `applyQuotaFallbackWhenAllowed` directly.

## Documentation updates

- No behavior changes; `v2/docs/v1-behaviors.md`'s shrink-flow entry (line
  ~108) already describes the observable ladder/fallback/telemetry behavior
  this subspec preserves. No update needed unless landing reveals an
  observable difference, in which case update that entry to match.
