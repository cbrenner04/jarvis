# Serialize per-file candidate scheduling

`verifyCandidates` in `diff-derived-mutation-verifier.ts` admits every candidate into `Promise.all` while `testCandidate` mutates and restores the shared production path in place. Two candidates for one file can overwrite each other's mutant or restoration, so a killing test may observe the wrong file content and nondeterministically report a false `surviving-mutation`. The test-run semaphore caps subprocess concurrency but does not protect same-file writes.

## Behavior

- Complete each same-file mutate → scoped test → restore cycle before starting that file's next candidate.
- Keep candidate groups for distinct production files eligible to overlap behind the existing test-run semaphore.
- Report a genuine surviving candidate at its exact source site while preserving `MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`, `MAX_CONCURRENT_VERIFIER_TEST_RUNS`, restoration, and first-survivor short-circuit.
- On first `surviving-mutation`, stop admitting further candidates; already-started per-file units may drain to completion via `Promise.all`; there is no survivor-triggered in-flight cancellation; when multiple units could race, first async assignment wins.

## Decisions

- Serialize by production-file path (`candidate.file` as stored — worktree-relative path from diff scan); rules out both globally serializing all candidates and concurrently writing isolated mutants to the shared imported path.
- Retain in-place mutation with restoration around each candidate; rules out inventing copy-based module resolution that no current killing-test caller supports.
- `MAX_INSPECTED_MUTATIONS` and `MAX_VERIFICATION_MS` gate candidate admission in flat derivation order; per-file units consume admitted candidates serially within each file without redefining those caps; rules out combining race repair with a rewrite of inspection or timeout semantics.
- Schedule cross-file groups as one async unit per distinct production path so same-file cycles run serially inside the unit while distinct paths still overlap; rules out a global candidate mutex that would collapse cross-file parallelism already capped by `MAX_CONCURRENT_VERIFIER_TEST_RUNS`.
- First-survivor short-circuit stops admission only; rules out survivor-triggered cancellation of in-flight per-file units or tie-breaking that differs from today's `verifyCandidates` loop.

## Tasks

- Reschedule `verifyCandidates` so candidates sharing a production `file` run serially and distinct files may still overlap.
- Add seam-driven regression tests in `diff-derived-mutation-verifier.test.ts` for same-file determinism, genuine survivors, cross-file overlap, restoration between same-file cycles, and first-survivor admission stop under the new scheduler.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` test `serializes same-file mutation candidates deterministically` drives at least two fully killed candidates for one production file through controlled read/write/test seams, proves each scoped test observes only its own mutant and the original is restored before the next mutation, and returns `kind: "pass"` across repeated invocations; it fails against the pre-fix concurrent same-path writes reachable in `verifyCandidates` today.
- [x] `diff-derived-mutation-verifier.test.ts` test `reports genuine surviving-mutation at exact source site on multi-candidate file` proves an uncovered candidate on a file with multiple candidates remains `surviving-mutation` at its exact source site; it fails if a same-file race misattributes the survivor.
- [x] `diff-derived-mutation-verifier.test.ts` test `overlaps distinct-file candidate cycles while serializing same-file cycles` uses seam instrumentation to prove concurrent scoped-test invocations across distinct production files while same-file writes are strictly sequential, and that peak in-flight scoped tests through `verifyDiffDerivedMutations` stay ≤ `MAX_CONCURRENT_VERIFIER_TEST_RUNS`; it fails against the pre-fix scheduler that serializes only at the subprocess semaphore or admits unbounded overlap at the entrypoint.
- [x] `diff-derived-mutation-verifier.test.ts` tests `caps inspected mutations and reports only what was inspected`, `stops at the wall-clock deadline without inspecting remaining candidates`, and `caps concurrent bun test invocations at MAX_CONCURRENT_VERIFIER_TEST_RUNS` stay green through the scheduler change.
- [x] `diff-derived-mutation-verifier.test.ts` test `short-circuits on first surviving-mutation under per-file scheduling` proves admission stops after the first `surviving-mutation` (later candidates are not admitted) while already-started per-file units may still drain; it fails if the per-file scheduler keeps admitting candidates after a survivor is recorded.
- [x] `v2/docs/workflow-runner.md` documents serial candidate cycles per production file, retained cross-file concurrency, and unchanged verifier bounds (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`, `MAX_CONCURRENT_VERIFIER_TEST_RUNS`).
- [x] `v2/docs/write-behavior.md` diff-derived mutation verification section documents same-file serial mutate/test/restore cycles, cross-file overlap, and unchanged verifier bounds (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`, `MAX_CONCURRENT_VERIFIER_TEST_RUNS`).
- [x] `v2/docs/operator-runbook.md` documents changing-site or manually killed `surviving_mutation_failed` survivors as the pre-fix same-file concurrency false-positive class and the serial flip-and-test reproduction check: at the reported source site, manually apply the named mutation (or flip the guard), run only the co-located killing test(s); if the test fails, treat as a harness false positive (pre-fix same-file concurrency or live-verification tree read — not merely "tree looked broken during live finalization"); if it passes, treat as a genuine uncovered guard (or refer to existing timer/dual-constraint runbook guidance).
- [x] `v2/docs/v1-behaviors.md` mutation-verification baseline separately states (1) same-file candidate cycles run serially (mutate → scoped test → restore before the next candidate on that file), (2) distinct production files' cycles may overlap, and (3) `MAX_CONCURRENT_VERIFIER_TEST_RUNS` caps in-flight verifier-launched test subprocesses — not "parallel candidates" or "parallel file-scoped runs" alone.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — serial candidate cycles per production file, retained cross-file concurrency, unchanged verifier bounds.
- `v2/docs/write-behavior.md` — same-file serial mutate/test/restore, cross-file overlap, unchanged verifier bounds.
- `v2/docs/operator-runbook.md` — changing-site or manually killed survivors as the pre-fix same-file concurrency false-positive and the serial flip-and-test reproduction check.
- `v2/docs/v1-behaviors.md` — corrected mutation-verification scheduling behavior in the parity baseline.
