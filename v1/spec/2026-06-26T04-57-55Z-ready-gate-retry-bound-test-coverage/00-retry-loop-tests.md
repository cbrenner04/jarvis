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
  as given; we test the loop's response to it. Because the seam bypasses the
  classifier, only `retryable` drives behavior; the `failureText` is unobserved,
  so these tests make no claim about how commit/push failures get classified.
- Per-check isolation (the seam closure cannot see check boundaries natively):
  - Exact `bound + 1` count is carried by the red→red→green variant, not by the
    sustained-red one. Its green return ends the run before any second
    completion check exists, so total seam invocations === attempts in the
    one-and-only check; assert the count directly (`gateCalls === 3` at bound 2).
  - The sustained-red variant isolates the first check with a reset-on-bound
    sentinel: the closure counts attempts and, when the counter reaches
    `totalAttempts`, records the per-check count and resets to 0 for the next
    check. Assert the first recorded count is exactly `bound + 1`. The retry
    stderr sequence is corroborating, not the proof of count.
  - The non-retryable variant's early-exit ends its check on the first red, so
    its per-check count is 1 by construction; assert the first check invoked the
    seam exactly once.
- Non-retryable red is a seam return of `{ kind: "red", retryable: false,
  failureText: <realistic commit/push-flavored string> }`. Run it at bound 2
  (not 0): the load-bearing assertion is the contrast — at bound 2 a *retryable*
  red emits `attempt 1/3, retrying`, a *non-retryable* red emits no `retrying`
  at all. At bound 0 this test would be indistinguishable from the existing
  bound-0 red test and prove nothing about non-retryability.
- Terminal red is distinguished from a retry by the colon form
  `ready gate failed:` (the retry line is `ready gate failed (attempt N/M),
  retrying`); the bare `ready gate failed` substring matches both, so assert the
  colon form (matching the existing bound-0 test).
- Assert sustained-red and non-retryable runs actually terminate red (non-zero
  exit and no `spec complete`), so the loop is proven to end rather than spin.
- Do not duplicate the override/default coverage already present (bound 1/6,
  `attempt 1/3`, `attempt 1/7`); extend the same describe block.

## Task checklist

- Add to the `readyGateRetryBound configuration` describe block in
  `v1/test/run.test.ts`:
  - Sustained retryable red, bound 2: gate returns retryable red every attempt;
    reset-on-bound sentinel records the first check's attempt count — assert it
    is 3; assert stderr emits `attempt 1/3, retrying` and `attempt 2/3,
    retrying`, never `attempt 3/3, retrying`, then `ready gate failed:`; assert
    terminal red (non-zero exit, no `spec complete`).
  - Non-retryable red, bound 2: seam returns `{ kind: "red", retryable: false }`
    with a realistic commit/push-flavored failure text; assert the first
    completion check invoked the seam exactly once, no `retrying` appears in
    stderr, and the run terminates red (non-zero exit, no `spec complete`).
  - Multi-retry retryable→green, bound 2: red→red→green; assert gate invoked
    exactly 3 times, exit 0, stdout contains `spec complete`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] A test in `v1/test/run.test.ts` proves sustained retryable red runs the
  completion ready gate exactly `bound + 1` times within a single completion
  check before returning red: at bound 2 a reset-on-bound sentinel records the
  first check's count as exactly 3, stderr contains `attempt 1/3, retrying` and
  `attempt 2/3, retrying` but never `attempt 3/3, retrying`, the terminal-red
  line `ready gate failed:` is emitted, and the run ends red (non-zero exit, no
  `spec complete`).
- [ ] A test proves non-retryable red (`retryable: false`) returns red on the
  first attempt at bound 2 — where a retryable red would have retried: the first
  completion check invokes the seam exactly once, no `retrying` message is
  emitted, and the run ends red (non-zero exit, no `spec complete`).
- [ ] A test proves retryable red across more than one retry eventually passes
  when a later attempt is green (bound 2, red→red→green ⇒ gate invoked exactly 3
  times, run exits 0, stdout contains `spec complete`). This green-terminating
  variant carries the exact `bound + 1` count proof (no loopback to contaminate
  the count).
- [ ] The pre-existing `attempt 1/7` (bound 6 override) and `attempt 1/3`
  (default-when-unset) tests stay green, keeping the override and default
  denominator guarded (no new work; the attempt-denominator-tracks-bound
  coverage is already satisfied).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

None. Test-only addition; no behavior, config, prompt, or operator-facing change,
so no `v2/docs/v1-behaviors.md` or config-doc update is warranted.
