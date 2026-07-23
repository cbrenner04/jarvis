# Name both constraints in the surviving-mutation error

## Problem

`SurvivingMutationError` (`v2/src/execution/ready-finalize.ts:75`) renders
`Surviving mutation in <file>:<line>: <mutation>`. When the changed line sits inside a
timer/interval callback in `v2/src/daemon/**` or `v2/src/execution/**`, the obvious kill test
— wait out the timer — is forbidden by `scripts/guard-deterministic-daemon-tests.ts`. The
operator sees only the mutation demand and no hint that the natural fix is barred, or that
predicate extraction satisfies both gates.

## Decisions

- Conflict detection lives in `diff-derived-mutation-verifier.ts` and rides on the `surviving-mutation` result; it already holds the candidate's path and file content — rules out re-reading source inside `SurvivingMutationError`.
- Determinism-guard coverage is decided by a predicate newly exported from `scripts/guard-deterministic-daemon-tests.ts` over the guard's own roots; rules out a second hardcoded root list in the verifier that drifts when the guard's roots change.
- Coverage means the mutated *production* path sits under a guarded root, because the killing test would live in that root's `.test.ts`; rules out testing the mutated file itself against the guard's `.test.ts` predicate, which is never true for a mutation site.
- Enclosure is a conservative textual scan for the nearest preceding `setTimeout(`/`setInterval(` whose argument span still contains the candidate line; rules out an AST dependency. Prefer false negatives (plain message) over false positives.
- The dual-constraint text is an appended clause on the existing `SurvivingMutationError` message; rules out a new failure code, a separate diagnostic channel, or a second error class.
- `SurvivingMutationLogFields` and the `surviving_mutation_failed` outcome kind are unchanged; rules out a new structured field the daemon host and runbook would have to document.
- Neither gate is weakened: no timer-callback exemption in the verifier, no real-timer allowance in the determinism guard; rules out "fixing" the conflict by relaxing a gate.
- No `v2/docs/v1-behaviors.md` entry: the diff-derived mutation verifier is v2-only with no v1 counterpart.
- If a timer-callback enclosure predicate already exists on `main` when this lands (from `timer-callback-guard-extraction-fixture`), reuse it rather than adding a second.

## Message shape

The appended clause must name all three, in the operator's terms:

1. the mutation requirement — a test that kills the mutation on that changed line in both directions;
2. the determinism-guard prohibition — no real-timer wait in that suite;
3. the fix — extract the guard into a pure predicate and test the predicate directly.

## Acceptance criteria

- [x] A new test drives `verifyDiffDerivedMutations` to a surviving mutation on a changed line inside a `setTimeout` callback in a `v2/src/execution/**` production file and asserts the resulting `SurvivingMutationError` message names the both-direction kill test on that line, the determinism guard's prohibition on real-timer waits in that suite, and predicate extraction as the fix; it fails against the pre-fix code.
- [x] A surviving mutation on a changed line outside any timer callback renders exactly the current `Surviving mutation in <file>:<line>: <mutation>` message, with the dual-constraint clause absent.
- [x] A surviving mutation inside a timer callback in a file outside the determinism guard's roots renders the current single-constraint message, with the dual-constraint clause absent.
- [x] Inverting the timer-callback enclosure check or the determinism-guard-coverage check fails at least one test; the two negative cases above assert absence of the appended clause, so an always-on clause is caught.
- [x] The determinism guard still reports a violation for a real-timer wait in a guarded suite, and mutation verification still reports a surviving mutation for an uncovered timer-callback guard — neither gate is relaxed.
- [x] The predicate newly exported from `scripts/guard-deterministic-daemon-tests.ts` is covered in both
      directions by `scripts/guard-deterministic-daemon-tests.test.ts`: a path under a guarded root and a
      path outside one, each asserted directly. Inverting the predicate's own condition fails a test —
      the mutation verifier flips guard tokens in that file, so a newly exported predicate that nothing
      asserts is uncovered.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts`, `v2/src/execution/ready-finalize.test.ts`, `v2/src/execution/write-loop.test.ts`, and `scripts/guard-deterministic-daemon-tests.test.ts` stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `surviving_mutation_failed` whose site is a timer callback in a determinism-guarded root names both gates and points at predicate extraction; the operator resumes after extracting, not after adding a timed test.
