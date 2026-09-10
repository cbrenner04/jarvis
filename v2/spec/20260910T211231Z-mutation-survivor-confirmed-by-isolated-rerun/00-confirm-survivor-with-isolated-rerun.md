# Confirm a surviving mutation with an isolated re-run

`testCandidate` in `v2/src/execution/diff-derived-mutation-verifier.ts` returns `surviving-mutation` as soon as one execution of the resolved killing set passes under the mutant. Run `1e1f893c` reported a false survivor at `v2/src/daemon/pipeline-daemon-resolution.ts:123` — a guard the co-located killing test does kill — because that single pass was unreliable under concurrent verifier test runs. One flaky pass fails a complete lane non-recoverably.

Add a confirmation run: when the killing set passes under the mutant, re-run the same set once more against the still-mutated tree with no sibling verifier test run in flight. A failing confirmation means the mutation is killed (candidate passes, verification continues to the next candidate); only a second clean pass returns `surviving-mutation`.

## Decisions

- Isolation is a new exclusive-acquisition mode on `VerifierTestRunSemaphore`: it waits for `inFlight === 0`, then holds all `limit` permits for the confirmation run's duration, blocking new `run()` acquisitions until it completes — rules out "hold all `MAX_CONCURRENT_VERIFIER_TEST_RUNS` permits via sequential per-call acquisition," which self-deadlocks against the same one-permit-per-call FIFO queue.
- Isolation is observed only at the default-implementation level, via `peakVerifierTestRuns()` (or equivalent exclusive-hold tracking) exercised by the existing "defaultRunScopedTests (real subprocess, no seam)" test group — rules out asserting isolation through the injected `runScopedTests` seam, which never reaches the semaphore.
- `runMutatedKillingSet` returns the timeout budget that produced a pass (e.g. `{ passed: true; timeoutMs } | { passed: false } | "inconclusive"`) instead of a bare boolean, and `testCandidate` gains `now`/`deadline` parameters threaded from `verifyCandidates` (which already closes over both) — rules out leaving the confirmation budget and deadline check unreachable at the candidate level.
- Confirmation re-runs the resolved killing set once more, under the semaphore's exclusive mode, at the budget the first pass used; a failing confirmation is a kill (loop continues to the next candidate), a passing confirmation returns `surviving-mutation`.
- Skip confirmation and report the survivor unchanged when `now() + <that budget> > deadline` — rules out letting confirmation push verification past `MAX_VERIFICATION_MS`.
- A confirmation run that times out settles the candidate `inconclusive` (a `skippedCandidates` entry), not `surviving-mutation` or `non-terminating-mutation` — the primary pass already proves the mutant terminates inside that budget, so routing the timeout to `non-terminating-mutation` would report a false non-terminator; rules out treating confirmation timeout the same as a primary-run timeout.
- A non-`ETIMEDOUT` throw during confirmation is unchanged: it propagates through `testCandidate`'s existing outer catch as a candidate error, same as any other non-timeout throw in that function today — rules out a special swallow-and-report-survivor path for confirmation errors.
- Confirmation runs only on the `surviving-mutation` path; `inconclusive`, `missing-killing-test`, `importer-discovery-cap-exceeded`, and `missing-render-coverage` are untouched — rules out re-running paths whose failure is not contention-shaped.
- The mutant stays on disk for the confirmation run; the existing `finally` restore in `testCandidate` is the only restore — rules out a restore/reapply cycle around confirmation.
- The `dualConstraint` determination is computed from the same inputs as today (`originalContent`, `candidate.line`, `guarded()`) and is unaffected by confirmation.
- Confirmation is not attempted a third time; two clean passes settle the survivor — rules out an unbounded retry loop.
- Accepted cost: every real survivor now pays one extra killing-set run before being reported. The confirmation run is designed to catch contention producing a false-clean pass (the evidence: run `1e1f893c`'s pass on a guard its killing test does kill, under concurrent verifier test runs). This mechanism is not independently proven; if the true cause were instead mutant-off-disk timing or empty killing-set resolution, an isolated re-run would reproduce the same clean pass and confirmation would be a no-op paying the same fixed cost.

## Acceptance criteria

- [x] A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` where the resolved killing set passes on the first run under the mutant and fails on the second returns a `pass` result with that candidate treated as killed; it fails against the pre-fix code.
- [x] A candidate whose killing set passes twice under the mutant still returns `surviving-mutation` naming the mutation and source file+line.
- [x] The confirmation run executes the same killing-set scope at the same `timeoutMs` that produced the first clean pass, including after the baseline-widened retry path.
- [x] In the "defaultRunScopedTests (real subprocess, no seam)" test group, `peakVerifierTestRuns()` (or equivalent exclusive-hold tracking) shows no overlap between a confirmation run and any concurrent scoped test run.
- [x] A survivor discovered with less remaining time than the confirmation run's budget is reported without a confirmation run.
- [x] A confirmation run that times out settles the candidate `inconclusive`, not `surviving-mutation` or `non-terminating-mutation`.
- [x] Inconclusive settlement on the non-confirmation path and `non-terminating-mutation` settlement are unchanged (existing inconclusive and non-terminating test cases in `v2/src/execution/diff-derived-mutation-verifier.test.ts` stay green).
- [x] The existing `finally` restore in `testCandidate` (`restores pre-mutation bytes after scoped-test timeout`) is unchanged; no applied mutant remains after verification returns on the confirmed-survivor path.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` mutation-verification section: a `surviving-mutation` requires two clean passes of the killing set, the second isolated via the semaphore's exclusive mode from concurrent verifier test runs, at the same budget and inside `MAX_VERIFICATION_MS`; a confirmation timeout settles `inconclusive`.
- Update `v2/docs/operator-runbook.md`: both the in-loop and publication-time `surviving-mutation` contract descriptions gain the two-clean-passes rule.
- Update `v2/docs/v1-behaviors.md` to record the confirmed-survivor behavior on the existing diff-derived mutation verification entry.
