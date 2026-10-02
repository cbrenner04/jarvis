# Serialize cross-importing concurrent production candidates

## Problem

`verifyCandidates` (`v2/src/execution/diff-derived-mutation-verifier.ts`) chains candidates per production file serially but runs distinct files concurrently via `Promise.all(fileChains.values())` on one `input.worktreePath`. While file Y's mutant is on disk, file X's resolved killing set can statically import Y; Y's mutant may hang or fail X's scoped runs, so X's candidate mis-settles (`non_terminating_mutation_failed` or a false kill/survivor). The symmetric failure is mutating Y while X is already inside `testCandidate` (mutant on disk through scoped runs) with a killing set that imports Y. Confirmation re-runs already isolate via `runScopedTests` `isolated` / `VerifierTestRunSemaphore.runExclusive` and must stay unchanged.

## Decisions

- Prefer import-aware serialization over per-candidate detached worktree copies for cross-file conflicts; rules out default `git worktree add` fan-out on every overlapping candidate as the primary fix (wall-clock and cleanup cost).
- Hold the isolation rule on production-file candidates in `verifyCandidates` only; prompt/render-observer verification stays on today's scheduling unless a constructible same-worktree cross-import overlap appears — Deferred to first consumer: extend the gate to prompt candidates — pin when a caller needs it.
- Treat a file as conflicting while its mutant bytes are applied and not yet restored (between mutation write and the existing `finally` restore); rules out inferring conflict from sidecar presence alone.
- For the full mutate→restore window, gate admission both ways: (1) do not apply this candidate's mutant until no in-flight mutated production file is reachable from this candidate's resolved killing tests via static relative import traversal; (2) do not apply a mutant to production file F while any in-flight candidate's resolved killing set transitively imports F; rules out one-sided clearance that only blocks this candidate from reaching in-flight mutants while Y still mutates under X's import of Y during X's scoped runs.
- Compute reachability from each killing test using `importedModulePaths` + `resolveImportedModule` (`runtime-smoke-verifier.ts`), BFS over imported production paths, same resolver killing-test discovery already uses for direct imports; rules out a second import parser.
- Admission is atomic across parallel file chains: register the in-flight mutated-file hold synchronously before writing mutant bytes, release only on the existing restore `finally` path; rules out await-clearance then register patterns that let two chains pass clearance before either holds (TOCTOU).
- When neither direction of the symmetric gate would conflict, concurrent candidates may share the worktree (today's parallelism); rules out serializing all distinct-file candidates regardless of import graph.
- Do not change `runDiffDerivedScopedTests` non-isolated vs `isolated` confirmation behavior; rules out folding confirmation into the new gate.

## Tasks

- [x] Add `killingSetImportsProductionFile` (or equivalent) helper: transitive static import closure from a killing test path to a target production path; unit tests for direct and chained relative import reachability.
- [x] In `verifyCandidates`, track in-flight mutated production files with atomic register-before-mutate / release-on-restore `finally`; await symmetric clearance (both gate directions) before each `testCandidate` mutant write.
- [x] Add `does not mis-settle non_terminating_mutation_failed on a cross-importing killing set while another file's mutant hangs` in `diff-derived-mutation-verifier.test.ts`: candidates on X and Y, X's killing test imports Y, Y's mutant hangs when Y is verified alone; fixture forces overlap where X is inside scoped killing-set runs and Y would otherwise mutate on the shared worktree under X's import of Y; pin X's full verifier outcome from an isolated X-only run; fails against pre-fix concurrent same-worktree scheduling on `main`.
- [x] Reconcile `v2/docs/v1-behaviors.md`, `v2/docs/write-behavior.md` § Diff-derived mutation verification, and `v2/docs/operator-runbook.md` § Mutation verification (Operational caveats) per Documentation updates.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` (or colocated helper test file) — unit coverage for `killingSetImportsProductionFile` (or equivalent): direct relative import reaches target production file; chained relative imports reach target production file.
- [x] `diff-derived-mutation-verifier.test.ts` — `does not mis-settle non_terminating_mutation_failed on a cross-importing killing set while another file's mutant hangs`: fixture with candidates on X and Y where X's killing test imports Y and Y's mutant hangs when Y is verified alone; forces overlap where X is in scoped killing-set runs while Y would otherwise mutate under that import; pins X's outcome from an isolated X-only verifier run and asserts full concurrent verification matches that baseline for X (`kind`, kill/survivor classification, and related exposed fields) and does not report `non_terminating_mutation_failed` for X because Y hung; fails against pre-fix concurrent same-worktree scheduling on `main`.
- [x] `diff-derived-mutation-verifier.test.ts` — `overlaps distinct-file candidate cycles while serializing same-file cycles` stays green (reachable on `main`).
- [x] `diff-derived-mutation-verifier.test.ts` — `isolates a confirmation re-run from a concurrent scoped test run via the real subprocess semaphore` stays green (reachable on `main`).
- [x] `v2/docs/v1-behaviors.md`, `v2/docs/write-behavior.md` § Diff-derived mutation verification, and `v2/docs/operator-runbook.md` § Mutation verification (Operational caveats) state the symmetric cross-file isolation rule per Documentation updates.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — reconcile the catalog bullet that concurrent candidates on distinct production files may overlap on one worktree: distinct files still parallelize when the symmetric import gate has no conflict; cross-import overlap serializes mutate→restore windows instead of sharing disk mutants.
- `v2/docs/write-behavior.md` § Diff-derived mutation verification — state the symmetric cross-file rule (shared worktree when neither gate direction conflicts; otherwise serialize) beside the existing same-file serial and `MAX_CONCURRENT_VERIFIER_TEST_RUNS` cap.
- `v2/docs/operator-runbook.md` § Mutation verification (Operational caveats) — same rule for operators inspecting `.jarvis-diff-derived-mutations/` while multiple production files verify.
