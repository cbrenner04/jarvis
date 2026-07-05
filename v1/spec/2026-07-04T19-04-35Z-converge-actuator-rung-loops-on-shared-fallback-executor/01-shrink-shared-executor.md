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
- Idle watchdog wiring (timer, `lastOutputAtMs`) stays per-rung as today —
  idle-timeout mechanics are out of scope; only the loop/fallback shell
  converges. Per the review-actuator subspec's abort-scoping resolution
  ([[00-review-actuator-shared-executor.md]]): `executeWithQuotaFallback`
  forwards one caller signal to every rung, so each binding's `invoke()` must
  own and dispose its own internal `AbortController` per invocation rather
  than sharing one controller across rungs — otherwise an idle-timeout abort
  on rung 1 permanently poisons rung 2's signal. Reuse whatever concrete
  mechanism 00 lands rather than re-deriving it; if 01 lands first, establish
  it here and have 00 reuse it.
- Unlike review's actuator, shrink's inline loop has no `onSpawned`/pgid-kill
  step — its watchdog kills solely via `shrinkController.abort()` plus
  `abortKillGraceMs`, both of which `createShrinkInvocationBinding` already
  threads through (`opts.abortKillGraceMs`, `opts.lastOutputAtMs`). No new
  hook surface is needed on this binding; confirmed by inspection
  (`shrink.ts:395-461`), unlike review's binding which is missing `onSpawned`.
- Successful rung result (`kind === "ok"`) and its originating `agent`/
  `configuredModel` must remain available after the executor call for the
  existing post-success pipeline (out-of-scope revert, spec-tree revert,
  contract validation, commit) — read these off `execution.final`.

## Task Checklist

- [ ] Replace the `for (let rungIndex ...)` loop with one
      `executeWithQuotaFallback` call over bindings built from
      `createShrinkInvocationBinding` per `reviewActuatorOrder` entry.
- [ ] Wire `shouldAdvance` per binding per the Decisions above.
- [ ] Give each binding invocation its own `AbortController`/watchdog timer
      (not one controller shared across `executeWithQuotaFallback`'s whole
      call), reusing the concrete mechanism [[00-review-actuator-shared-executor.md]]
      establishes, so a rung 1 idle-timeout abort cannot poison rung 2's
      signal.
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

- [x] `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` stays green
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
- [x] `runPatchShrinkPhase`'s rung loop calls `executeWithQuotaFallback`
      (`shared/invocation/execute.ts`) via `createShrinkInvocationBinding`
      instead of a hand-rolled `for` loop calling
      `applyQuotaFallbackWhenAllowed` directly.
- [x] A test (existing or new) asserts the fallback rung's `invoke()` receives
      a non-aborted signal after a prior rung's idle-timeout abort — covering
      the per-rung controller-ownership mechanism, since the current
      idle-watchdog fallback test's fake agent never inspects
      `opts.signal.aborted` and would not catch a regression to one
      controller shared across rungs.

## Documentation updates

- No behavior changes; `v2/docs/v1-behaviors.md`'s shrink-flow entry (line
  ~108) already describes the observable ladder/fallback/telemetry behavior
  this subspec preserves. No update needed unless landing reveals an
  observable difference, in which case update that entry to match.
