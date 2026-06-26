# Retry-loop tests for readyGateRetryBound

## Problem

The completion ready-gate retry loop (`runCompletionReadyGate` in
`v1/src/modes/patch/completion-pipeline.ts`) re-runs the gate on retryable red up
to `readyGateRetryBound` (default 2 ⇒ 3 attempts). The existing
`readyGateRetryBound configuration` describe block in `v1/test/run.test.ts`
covers config validation, single-retry-then-green (bounds 1/6), and the default
denominator — but leaves two loop branches unguarded:

- Sustained retryable red exhausting exactly `bound + 1` attempts in one
  completion check (the bound-0 test counts across two checks, contaminated by
  fix-up loopback).
- Non-retryable red: every existing red omits `retryable`, so the
  `retryable === false` early-exit at `completion-pipeline.ts:269` is never
  exercised.

## Decisions

- Drive the loop through the existing `opts.runCompletionReadyGate` seam (same
  pattern as the current gate-loop tests), not the real `runReadyAndCommit`
  path. Rationale: the real error-type→`retryable` classifier
  (`completion-pipeline.ts:251-257`) is only reachable via real command/git
  failures — testing it would need a production seam, which is out of this
  add-tests intent's scope. The intent's "Out of scope" pins the classification
  as given; we test the loop's response to it.
- Assert "exactly `bound + 1` attempts in one check" via the stderr retry-message
  sequence (`attempt N/M, retrying`), not cross-check call counting — the
  message is emitted only for attempts `< totalAttempts`, so it pins the count
  without contamination from fix-up loopback.
- Represent non-retryable red as a seam return of
  `{ kind: "red", retryable: false, failureText: <commit/push-flavored> }` — that
  is exactly how the classifier flags commit/push fix-up failures.
- Do not duplicate the override/default coverage already present (bound 1/6,
  `attempt 1/3`, `attempt 1/7`); extend the same describe block.

## Task checklist

- Add to the `readyGateRetryBound configuration` describe block in
  `v1/test/run.test.ts`:
  - Sustained retryable red, bound 2: gate returns red every attempt; assert
    first completion check emits `attempt 1/3, retrying` and `attempt 2/3,
    retrying`, never `attempt 3/3, retrying`, then `ready gate failed`.
  - Non-retryable red: seam returns `{ kind: "red", retryable: false }` with a
    commit/push-flavored failure text; assert no `retrying` appears in stderr and
    the gate is invoked once per completion check.
  - Multi-retry retryable→green, bound 2: red→red→green; assert gate invoked 3
    times, exit 0, `spec complete`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] A test in `v1/test/run.test.ts` proves sustained retryable red runs the
  completion ready gate exactly `bound + 1` times within a single completion
  check before returning red (e.g. bound 2 ⇒ stderr contains `attempt 1/3,
  retrying` and `attempt 2/3, retrying`, never `attempt 3/3, retrying`, then
  `ready gate failed`).
- [ ] A test proves non-retryable red (`retryable: false`, commit/push fix-up
  failure) returns red on the first attempt: no `retrying` message is emitted and
  the gate is not re-invoked within that completion check.
- [ ] A test proves retryable red across more than one retry eventually passes
  when a later attempt is green (bound 2, red→red→green ⇒ gate invoked 3 times,
  run exits 0, stdout contains `spec complete`).
- [ ] Per-project `readyGateRetryBound` override and the default-when-unset
  (2 ⇒ 3 attempts) remain guarded by tests asserting the attempt denominator
  tracks the configured bound (existing `attempt 1/7` and `attempt 1/3` tests
  satisfy this; not duplicated).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

None. Test-only addition; no behavior, config, prompt, or operator-facing change,
so no `v2/docs/v1-behaviors.md` or config-doc update is warranted.
