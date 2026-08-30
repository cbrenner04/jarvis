# Skip unappliable candidates instead of crashing the run

## Problem

When a derived mutation candidate cannot be applied, the diff-derived verifier crashes the whole run non-resumably. `applyMutation` throws on a slice-verify mismatch (the derived `originalText`/columns do not match the source line) or an out-of-bounds line; `testCandidate`'s catch restores the file and **re-throws** `Failed to test candidate for <file>:<line>`, which propagates through `verifyCandidates` → `verifyDiffDerivedMutations` → the write loop as `run_execution_failed` (`invocation_error`, `retryable: false`, `nextAction: stop`). A single mis-derived candidate — e.g. guard-flip mis-slicing `!obj.method()` — thus strands an otherwise-complete implement with no resume path. Observed twice in one session (`cleanup-uses-lossless-git-status`, `accept-nested-plan-draft-stage-layout`), both stranding complete, covered work.

This is the containment half of [[guard-flip-derivation-crash-is-contained]]; the root-cause slice fix (deriving `!obj.method()` correctly) stays in that seed as follow-up. Containing the crash restores resumability and stops one malformed candidate from forfeiting a whole run.

## Surface

Candidate application and testing in `v2/src/execution/diff-derived-mutation-verifier.ts` (`testCandidate`, `applyMutation`, `verifyCandidates`, and the `PassResult` shape); co-located regressions in `v2/src/execution/diff-derived-mutation-verifier.test.ts`; operator/contract docs. No change to candidate derivation, killing-test resolution, `@mutate-equivalent` acceptance, or the surviving-mutation contract.

## Decision ledger

- An unappliable candidate (`applyMutation` slice-verify mismatch or out-of-bounds line) is **skipped**: restore the file and continue to the next candidate; never re-throw as a run-crashing error. Rules out the current `testCandidate` re-throw that settles `run_execution_failed`.
- The skip is **observable, not silent**: add `skippedCandidates` to `PassResult` (each entry names `file`, `line`, and a `reason`), so a dropped candidate is auditable in the verifier result rather than lost. Rules out silently returning `null` with no record.
- Only `applyMutation`-derived unappliability is contained here. Genuine infrastructure failures (a `writeFile`/`runScopedTests` seam throwing) keep surfacing as before — they are real, not malformed candidates. Rules out swallowing every `testCandidate` throw indiscriminately.
- A skipped candidate is neither a `surviving-mutation` nor a kill: it is simply untested. When every candidate on a file is applied or skipped and none survives, the file passes. Rules out a skipped candidate being reported as a false surviving mutation.

## Task checklist

- Make `applyMutation` signal unappliability distinguishably (a typed unappliable result or a named error class) instead of a bare `Error`, so `testCandidate` can tell an unappliable candidate from an infra failure.
- In `testCandidate`, on an unappliable candidate: restore the original file content and return a skip signal (not a throw, not a surviving-mutation); on any other error, preserve current surfacing.
- Thread skipped candidates up through `verifyCandidates` into `PassResult.skippedCandidates`.
- Add `diff-derived-mutation-verifier.test.ts` regressions (see acceptance criteria), using the existing injected `readFile`/`writeFile`/`runScopedTests`/`gitDiff` seams.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` test `skips an unappliable candidate without crashing the run` drives `verifyDiffDerivedMutations` (injected seams) over a changed file whose derived candidate cannot apply (its `originalText`/columns do not match the source line), and asserts the call resolves to a `pass` result with no thrown error; it fails against the pre-fix `Failed to test candidate` re-throw.
- [ ] `diff-derived-mutation-verifier.test.ts` test `records skipped candidates on the pass result` asserts the unappliable candidate appears in `PassResult.skippedCandidates` with its `file`, `line`, and a non-empty `reason`, and is absent from any surviving-mutation report; it fails against the pre-fix silent `null`.
- [ ] `diff-derived-mutation-verifier.test.ts` test `well-formed candidates still detect surviving and covered guards` proves an applicable uncovered guard still returns `surviving-mutation` and an applicable covered guard returns `pass` (no regression to detection or killing-test resolution) alongside a skipped sibling candidate on another line.
- [ ] `diff-derived-mutation-verifier.test.ts` test `a genuine seam failure still surfaces` proves a `writeFile`/`runScopedTests` seam throw is not swallowed as a skip (infra failures keep their current surfacing), distinguishing it from an unappliable candidate.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust / mutation verification: an unappliable (mis-derived) candidate is skipped and listed in `PassResult.skippedCandidates`, not a `run_execution_failed` crash; the underlying guard-flip slice bug is tracked separately in `guard-flip-derivation-crash-is-contained`.
- `v2/docs/workflow-runner.md` — the diff-derived verifier contains unappliable candidates (skip + record) rather than failing the run.
