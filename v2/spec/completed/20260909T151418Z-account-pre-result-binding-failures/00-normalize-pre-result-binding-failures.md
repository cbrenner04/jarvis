# Normalize pre-result binding failures at the shared invocation boundary

## Problem

`executeWithQuotaFallback` (`shared/invocation/execute.ts`) awaits `binding.invoke(...)` unguarded. A rejection — spawn failure, adapter crash, anything before a typed `InvocationResult` — propagates out of the chain: no attempt is pushed, no `invocation_completed` row is appended, no session-transcript inbound line is written, and later rungs are never tried. At the `runStep` boundary (`v2/src/execution/step-runner.ts`) this surfaces as an uncaught rejection instead of a settled `invocation_failure` outcome. The operator sees a run failure with nothing attributable to an agent, model, or binding.

## Behavior

Every entered binding attempt is represented. A rejecting `invoke` is normalized in place to a failure `InvocationResult` carrying the thrown diagnostic as `stderr`, then flows through the existing path unchanged: session-transcript inbound logging, attempt push, telemetry append, and the binding's own `shouldAdvance` decision (default: quota-only advance, so a normalized failure stops the chain at the first rung unless the binding overrides `shouldAdvance`). A caller-driven cancellation (the invocation `signal` already aborted when `invoke` rejects) is not a binding failure and is not normalized — it propagates unchanged so kill/timeout handling is unaffected.

## Decisions

- Normalize at the `binding.invoke` await inside `executeWithQuotaFallback`; rules out loop-specific synthetic telemetry in callers, which misses other callers and can double-count attempts.
- Normalize to `kind: "error"` so the failure reuses the existing terminal-`error` classification path; rules out a new `InvocationResult` variant, which would force every consumer's exhaustive switch to change.
- Reuse `exitCode: -1` — the sentinel `shared/invocation/agents.ts` already returns from its own spawn/abort failures (`runAgent`, `singleSpawn`) for "no process exit code was observed" — instead of inventing a new sentinel; a real process exit code is always `>= 0`, so `-1` is already established as non-colliding.
- `stderr` on the normalized result is the thrown value's message (`String(error)` for non-`Error`); rules out dropping the diagnostic or serializing a stack into telemetry.
- Type a normalized failure as `InvocationError` without an `as T`/`as unknown as T` assertion: widen `InvocationBinding.shouldAdvance` to `(result: T | InvocationError) => boolean` and `InvocationAttempt<T>.result`/`InvocationExecution<T>` to `T | InvocationError`; rules out silently mistyping a normalized failure as a successful-shaped `T` for a binding whose generic narrows below the full `InvocationResult` union. Every current binding (`v2/src/execution/step-runner.ts`, `write-loop.ts`, `review-role-invocation.ts`) uses the default `T = InvocationResult`, so `T | InvocationError` collapses to `InvocationResult` and this is not an observable behavior change today.
- Apply the binding's existing `shouldAdvance` predicate to the normalized result, including the default (`result.kind === "quota"`) when the binding sets no predicate; rules out making observability repair an unconditional chain stop or an unconditional fallback, and rules out assuming every binding advances on `error` — no current v2 binding overrides `shouldAdvance`, so a normalized failure stops the chain at the first rung by default, same as an agent-returned `error` result.
- Do not normalize a rejection when `args.signal?.aborted` is already `true` at the moment `invoke` rejects; rethrow it unchanged. Rules out reclassifying caller-driven cancellation (run pause/kill/timeout) as a binding failure, which would attribute a telemetry row and possibly unlock fallback advancement for a chain the caller is tearing down.
- `invocation_completed.exit_reason` for a normalized failure is the sentinel-only string `exit_code:-1` (the existing `kind: "error"` shape); the raw thrown diagnostic is not duplicated into telemetry, only into the session transcript's `inbound_stderr` line. Rules out assuming telemetry alone carries the failure text.
- Do not catch around telemetry append or session-log append; those already have their own swallow paths.
- Do not investigate or change the underlying agent spawn defect; the incident evidence does not identify one adapter.

## Task checklist

- [ ] Wrap the `binding.invoke` await in `shared/invocation/execute.ts`, skip normalization when the signal is already aborted, and normalize any other rejection to the failure result.
- [ ] Widen `InvocationBinding.shouldAdvance` and `InvocationAttempt`/`InvocationExecution` typing to `T | InvocationError` as decided above.
- [ ] Fix the stale `executeWithQuotaFallback` doc comment describing plan/intent inner-loop `shouldAdvance` overrides advancing on `error`/`model_config` — no live v2 binding does this; that override only ever existed in frozen v1.
- [ ] Add tests to `shared/invocation/execute.test.ts` covering telemetry attribution, default- and custom-`shouldAdvance` obedience and chain order, cancellation non-normalization, sentinel distinguishability, and transcript retention.
- [ ] Add a regression test to `v2/src/execution/step-runner.test.ts` proving `runStep` settles to `invocation_failure` instead of rejecting when the sole binding's `invoke` rejects.
- [ ] Update the docs below.

## Acceptance criteria

- [x] `shared/invocation/execute.test.ts` proves a binding whose `invoke` rejects before returning an `InvocationResult` yields an ordered attempt and one `invocation_completed` row naming `agent`, `model`, `binding_id`, and a failure `exit_kind`; it fails against the pre-fix escaping-failure path.
- [x] `shared/invocation/execute.test.ts` proves a normalized pre-result failure obeys the binding's `shouldAdvance` policy — the default (quota-only) policy stops the chain at the first rung, and a binding-supplied predicate advances or stops per its own return value — and that every attempted rung is returned in chain order.
- [x] `shared/invocation/execute.test.ts` proves a rejection that occurs while the invocation's `signal` is already aborted is not normalized: it still propagates out of `executeWithQuotaFallback` with no attempt pushed and no telemetry row appended.
- [x] `shared/invocation/execute.test.ts` proves the normalized sentinel (`exit_code:-1`) is distinguishable from a binding-returned `kind: "error"` result carrying a real process exit code, by asserting both `invocation_completed.exit_reason` values in the same test.
- [x] `shared/invocation/execute.test.ts` proves the raw thrown diagnostic reaches the invocation session transcript as an `inbound_stderr` line, and that `invocation_completed.exit_reason` for the same attempt contains only the sentinel exit-code string, not the diagnostic text.
- [x] `v2/src/execution/step-runner.test.ts` proves `runStep` returns a settled `{ kind: "invocation_failure", failureKind: "error", ... }` outcome, not a rejected promise, when the sole configured binding's `invoke` rejects before returning a result; it fails against the pre-fix escaping-failure path.
- [x] Existing settled-result telemetry and quota-fallback tests in `shared/invocation/execute.test.ts` stay green (behavior unchanged for bindings that return a typed result).
- [x] `v2/docs/shared-invocation.md` documents pre-result failure normalization, the default-`shouldAdvance` fallback consequence, cancellation exclusion, and the transcript-vs-telemetry diagnostic split.
- [x] `v2/docs/operator-runbook.md` states that an entered binding leaves an attributed telemetry row only when telemetry context, that binding's invocation ID, and its `agent`/`model` metadata were all present for the attempt, so a correctly filtered empty result under those conditions means no binding was entered.
- [x] `v2/docs/v1-behaviors.md` amends the existing shared-invocation entries covering `shared/invocation/execute.ts`/`agents.ts` telemetry to record the changed v2 binding-failure behavior, rather than adding an unrelated new entry.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` and `bun run test:integration:shared` pass.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — pre-result binding failure normalization: telemetry row, default-`shouldAdvance` fallback consequence, cancellation exclusion, transcript-vs-telemetry diagnostic split.
- `v2/docs/operator-runbook.md` — reading telemetry: an entered binding leaves an attributed row only when telemetry context, invocation ID, and binding metadata were present for that attempt.
- `v2/docs/v1-behaviors.md` — amend the existing shared-invocation telemetry entries with the changed v2 binding-failure behavior.
