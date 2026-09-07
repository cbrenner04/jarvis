# Verifier bounded killing-test execution

## Problem

`runDiffDerivedScopedTests` awaits verifier-launched `bun test` subprocesses without a per-call wall clock. A non-terminating mutant (for example a `guard-flip` on a `while (true)` exit condition) hangs the killing test indefinitely, blocks `testCandidate` restore, and leaves the owning run live with no agent past every watchdog.

## Decision ledger

- Export `MAX_KILLING_TEST_MS = 30_000` beside the existing verifier ceilings and pass it as `timeoutMs` on every real `runDiffDerivedScopedTests` `runAsync` call; rules out unbounded await and a budget outside the five-minute `MAX_VERIFICATION_MS` verifier ceiling.
- Enable detached process-group mode on those calls so expiry and abort signal the whole group (`SIGTERM` then `SIGKILL`); rules out direct-child kill leaving `bun test` pool workers alive (reachable on `shared/subprocess.ts` group mode today).
- Add `non-terminating-mutation` to `VerificationResult` when a scoped killing-test run times out; rules out scoring timeout as pass, caught, or `surviving-mutation`.
- Restore pre-mutation bytes in unconditional cleanup on every `testCandidate` exit path (timeout, abort, subprocess failure, thrown error) before returning or propagating; rules out restore-only-after-`runScopedTests` return leaving a poisoned worktree when the await never settles.

## Prerequisites

- `shared/subprocess.ts` `realAsyncSubprocessRunner.runAsync` supports `timeoutMs` and `processGroup` detached group termination.
- Diff-derived verification resolves scoped killing tests per candidate, serializes candidates per production file, and caps concurrent verifier test subprocesses (`MAX_CONCURRENT_VERIFIER_TEST_RUNS`).

## Task checklist

- Add `MAX_KILLING_TEST_MS` and wire `timeoutMs` plus `processGroup` through `runDiffDerivedScopedTests` default subprocess path.
- Extend `VerificationResult` with `non-terminating-mutation` carrying mutation string and source site (same shape as `surviving-mutation` minus `dualConstraint`).
- Classify scoped-test timeout as `non-terminating-mutation` in `testCandidate` / `verifyCandidates` short-circuit paths.
- Restructure `testCandidate` so restore runs in a `finally` (or equivalent) that executes even when `runScopedTests` rejects on timeout.
- Add `diff-derived-mutation-verifier.test.ts` regressions for hang termination, distinct outcome classification, and post-timeout restore.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` proves a killing-test subprocess that never exits is terminated at `MAX_KILLING_TEST_MS` and `verifyDiffDerivedMutations` settles instead of hanging; it fails against the pre-fix unbounded `runAsync` await reachable on `runDiffDerivedScopedTests`.
- [x] `diff-derived-mutation-verifier.test.ts` proves scoped-test timeout returns `kind: "non-terminating-mutation"` rather than `pass`, caught (tests-failed), or `surviving-mutation`; it fails against the pre-fix binary classification where timeout rejects as a caught mutation.
- [x] `diff-derived-mutation-verifier.test.ts` proves pre-mutation bytes are restored after timeout; it fails against the pre-fix restore-only-after-return path in `testCandidate`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
