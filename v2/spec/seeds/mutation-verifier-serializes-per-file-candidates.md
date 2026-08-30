# Diff-derived mutation verifier races concurrent same-file candidates → nondeterministic false survivors

## Problem

`verifyCandidates` (`v2/src/execution/diff-derived-mutation-verifier.ts`) tests every candidate concurrently via `Promise.all`. `testCandidate` mutates the candidate's production file **in place** — `writeFile(filePath, mutatedContent)` → run co-located tests → `finally writeFile(filePath, originalContent)`. When a changed production file carries ≥2 mutation candidates (the common case — any file with several changed comparison guards), the concurrent candidates read-modify-write the **same path**: candidate A writes mutation-A, candidate B overwrites with mutation-B (or its restore of the original), and A's co-located test then runs against B's file content. A test that would kill mutation-A now passes (it ran against the original or a different mutant) → A is falsely reported `surviving-mutation`. The `MAX_CONCURRENT_VERIFIER_TEST_RUNS` semaphore caps concurrent `bun test` subprocesses but does **not** serialize the file writes, so the race is unguarded.

The result is a mutation gate that strands correct, fully-covered implements on a "surviving" mutation that no manual test can reproduce — nondeterministically, and on a different line each run.

## Evidence (2026-08-30)

On branch `20260830T062002Z-durable-run-backed-stage-settlement` (#3173), `pipeline-stage-settlement.ts` carries ~13 operator-flip candidates in one file. With exhaustive branch-killing tests committed (every branch pinned by exact-shape `toEqual`), three consecutive `verifyDiffDerivedMutations({worktreePath, runBase:"main"})` runs on the **same clean tree** reported three different results: `operator-flip: === → !== @ 43`, then `!= → == @ 27`, then `!= → == @ 27`. A genuine coverage gap is deterministic — it flags the same site every run. Manual serial proof: applying each reported flip by hand (`sed`, restore) and running the co-located test **kills** it every time (line 27 → 1 test fail; line 43 → infinite recursion in the mapped fn → test never passes; line 53 already killed by the committed model_config test). So coverage was complete and every reported survivor was a false positive from the concurrent shared-file writes. This is the same "can't reproduce the survivor" strand class the session has repeatedly hand-finished; the race is a strong candidate for its dominant root.

## Decisions

- Serialize per-file candidate testing: group candidates by production file and test that file's candidates **sequentially** (one mutate→test→restore at a time), while different files may still run concurrently. Rules out concurrent writes to a single path.
- OR (alternative, if cross-file parallelism must be preserved within a file) mutate an isolated copy and run the test against the copy so the shared production path is never written concurrently — but the co-located test imports the production path, so per-file serialization is the simpler correct fix. Pick one; do not leave the shared-path write concurrent.
- Preserve the existing bound semantics (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`, the test-run semaphore) and the first-survivor short-circuit. Rules out a rewrite of the bounds/verdict machinery.

## Acceptance criteria

- [ ] A verifier unit test proves that a file with ≥2 mutation candidates, each fully covered by a co-located killing test, yields `kind: "pass"` deterministically across repeated invocations (e.g. an injected `runScopedTests`/`writeFile` seam that asserts no candidate's test ever observes another candidate's mutation on the shared file); it fails against the pre-fix concurrent path, which can surface a false `surviving-mutation`.
- [ ] A verifier unit test proves a genuine uncovered candidate on a multi-candidate file is still reported `surviving-mutation` at its exact site (no false negative from serialization).
- [ ] Candidates across distinct files may still be inspected without forcing full global serialization (a test or assertion that two different files' candidates are not serialized behind each other), OR an explicit decision recorded that global serialization is acceptable.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust / mutation-verification: a "surviving" mutation that changes site between runs, or that a manual serial flip+test kills, is the verifier's own concurrency false-positive, not a coverage gap; the fix serializes per-file candidates.
- `v2/docs/workflow-runner.md` — completion-verification: per-file candidate testing is serial; cross-file may be concurrent.

## Sequencing

P0, mutation-gate group. Independent of the four existing mutation-gate seeds but arguably higher-leverage than several — it removes a whole class of unreproducible strands. Compatible with [[implement-verifies-mutations-in-loop]] (same verifier, in-loop) and [[mutation-gate-equivalent-mutation-escape-hatch]] (an accepted-equivalent site is unaffected by serialization).
