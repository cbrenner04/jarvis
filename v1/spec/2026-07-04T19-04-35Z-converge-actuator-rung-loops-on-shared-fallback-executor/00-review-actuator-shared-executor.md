# Review actuator onto shared executor

## Problem

`createActuator` in `v1/src/modes/patch/review.ts` (`runPatchReviewPhase`, rung
loop at `review.ts:869-1206`) hand-rolls a `for` loop over `reviewActuatorOrder`
instead of using `executeWithQuotaFallback` (`shared/invocation/execute.ts`).
Plan's `verdict-actuator.ts` already runs the equivalent rung loop through that
shared executor. The duplicated control flow is a standing drift risk (it
already produced one bug: the loop used to throw immediately on quota instead
of falling through).

## Decisions

- Rung iteration moves onto `executeWithQuotaFallback`; per-rung agent
  invocation moves into an `InvocationBinding` built with
  `createReviewInvocationBinding` (`v1/src/modes/review/review-invocation-binding.ts`),
  whose `adapter.buildPrompt` returns the already-built verdict-actuator prompt
  unchanged per rung — rules out re-deriving the prompt per-binding-call, which
  would risk divergence from the single `buildVerdictActuatorPrompt` call site.
- Bindings set an explicit `shouldAdvance` covering `kind === "quota"` and
  `kind === "error" && stderr.includes("aborted: idle-timeout")` — the executor's
  default (`quota`-only) would make idle-timeout terminal on the first rung,
  breaking the existing idle-timeout-advances-to-next-agent behavior.
- `model_config` and any other `error` stay outside `shouldAdvance` (default
  false), so they remain terminal on whichever rung they occur — unchanged from
  today.
- All side effects currently inline in the loop body — telemetry writes
  (`opts.writeTelemetry`), verdict-file restore, spec-tree-edit revert,
  commit/push/reconcile/PR-footer-refresh, non-fast-forward convergence, and the
  auth-failure-vs-strict-quota stderr line selection — move into callbacks
  invoked from `execution.attempts`/`execution.final` after
  `executeWithQuotaFallback` returns, not into the shared executor. The executor
  stays a bare rung/fallback iterator; it must not gain review-specific
  knowledge (verdict files, git commits), which would defeat the point of
  sharing it with plan's verdict actuator.
- Per-rung idle watchdog wiring (timer, `AbortController`, descendant tracking,
  pgid kill) stays as today, attached per binding invocation — the intent marks
  the idle-timeout watchdog mechanics themselves out of scope; only the
  loop/fallback shell around them converges.
- Exit-code mapping (`3` for `model_config`, agent's `exitCode` for `error`, `11`
  terminal-idle path via `ReviewTerminalError`) is computed once from
  `execution.final`, replacing the equivalent per-iteration `throw` statements at
  the bottom of the current loop.

## Task Checklist

- [ ] Replace the `for (let rungIndex ...)` loop in `createActuator`'s returned
      function with one `executeWithQuotaFallback` call over bindings built per
      `actuatorOrder` entry.
- [ ] Wire `shouldAdvance` per binding per the Decisions above.
- [ ] Move the success path (verdict restore, spec-tree revert, commit/push/PR
      update, non-fast-forward convergence, `ok`/`no-changes` telemetry) into a
      post-execution handler that runs once against `execution.final` when
      `kind === "ok"`.
- [ ] Move per-rung fallback stderr lines (idle-timeout escalation line, quota
      strict/auth-rotate line selection) and their telemetry rows into the
      binding's invoke path or a per-attempt callback, preserving exact existing
      message text and `exitReason` values.
- [ ] Move terminal-error handling (final-rung idle timeout, `model_config`,
      other `error`) into a handler keyed on `execution.final`, preserving
      existing `ReviewTerminalError` messages and exit codes.
- [ ] Preserve the "no agents available" path (`actuatorOrder.length === 0`)
      without going through the executor (it never had a rung to run).

## Acceptance criteria

- [ ] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` stays green
      (behavior unchanged by the refactor), specifically: `actuator falls back
      through reviewActuator order on quota`, `model_config exits 11 and
      all-agent quota exits 11`, `actuator preserves verdict and reverts
      completed spec edits`, `idle watchdog escalates through reviewActuator
      when fallback rung remains`, `idle watchdog on final reviewActuator rung
      exits 11 with terminal watchdog-idle-timeout`, `review actuator with
      idleOutputTimeoutMs 0 does not idle-escalate`, `review actuator iteration
      wall abort is terminal with no ladder advance`, `emits auth note on auth
      failure in review quota rotation`, `emits quota line (not auth note) on
      plain quota in review rotation`, `actuator invokes reconcile before push
      (via commitPass)`, `empty verdict skips actuator invocation`, `orphan
      reaping: verdict actuator polls and reaps via override`.
- [ ] `createActuator`'s rung loop calls `executeWithQuotaFallback`
      (`shared/invocation/execute.ts`) instead of a hand-rolled `for` loop.

## Documentation updates

- `v2/docs/v1-behaviors.md` line ~306 ("Patch keeps its own iteration-driven
  loop and does not use the shared executor") describes patch *implementation*
  iteration (`iteration.ts`) and is unaffected by this change; leave it, but
  confirm on landing that it still reads as scoped to implementation only (not
  review/shrink) and clarify the wording if this refactor makes it ambiguous.
