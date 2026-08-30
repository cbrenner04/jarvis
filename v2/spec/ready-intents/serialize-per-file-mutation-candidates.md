---
name: serialize-per-file-mutation-candidates
---

# Serialize per-file mutation candidates

Unsplit rationale: Candidate scheduling, mutation execution, regression coverage, and durable documentation all belong to execution-loop mutation verification; no second module boundary changes.

## Primary implementation surface

- Execution-loop mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

## Problem

- `verifyCandidates` starts all candidates concurrently while `testCandidate` mutates and restores the shared production path in place.
- Two candidates for one file can overwrite each other's mutant or restoration, so a killing test may observe the wrong file content and nondeterministically report a false `surviving-mutation`.
- The test-run semaphore bounds subprocess concurrency but does not protect same-file writes.

## Behavior

- Test one file's candidates sequentially, completing each mutate → scoped test → restore cycle before starting that file's next candidate.
- Keep candidate groups for distinct production files eligible to overlap.
- Report a genuine surviving candidate at its exact source site while preserving the existing inspection cap, wall-clock deadline, test-run semaphore, and first-survivor short-circuit.

## Decision ledger

- Serialize by production-file path; rules out both globally serializing all candidates and concurrently writing isolated mutants to the shared imported path.
- Retain in-place mutation with restoration around each candidate; rules out inventing copy-based module resolution that no current killing-test caller supports.
- Preserve existing bounds and verdict selection around the per-file scheduler; rules out combining race repair with a rewrite of inspection or timeout semantics.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` deterministically drives at least two fully killed candidates for one file through controlled read/write/test seams, proves each scoped test observes only its own mutant and the original is restored before the next mutation, and returns `kind: "pass"` across repeated invocations; it fails against the pre-fix concurrent same-path writes.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a genuine uncovered candidate on a multi-candidate file remains `surviving-mutation` at its exact source site.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves candidates for two distinct files can overlap while same-file candidate cycles cannot.
- [ ] Verifier tests pin `MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`, `MAX_CONCURRENT_VERIFIER_TEST_RUNS`, restoration, and first-survivor behavior through the scheduler change.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document serial candidate cycles per production file, retained cross-file concurrency, and unchanged verifier bounds.
- `v2/docs/operator-runbook.md` — document changing-site or manually killed survivors as the pre-fix same-file concurrency false-positive and the serial reproduction check.
- `v2/docs/v1-behaviors.md` — record the corrected existing mutation-verification scheduling behavior in the parity baseline.
