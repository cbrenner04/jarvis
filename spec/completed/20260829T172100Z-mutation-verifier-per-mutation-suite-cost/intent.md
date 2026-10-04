---
name: mutation-verifier-per-mutation-suite-cost
---

# Diff-derived mutation verification stays within post-write budget

## Prerequisites

## Problem

- Ready-finalization diff-derived mutation verification classifies the whole production diff once and re-runs the full CI union per candidate; on `shared/**` diffs that fans to multiple full-suite `bun test` invocations per mutation, exhausts the verifier's post-write `MAX_VERIFICATION_MS` budget, and leaves the durable row `in-progress` after the agent has already written correct code.

Unsplit rationale: Per-candidate suite scoping, post-write verifier bounds, and verifier concurrency all live on the diff-derived mutation verification and ready-finalization boundary; splitting would ship partial fixes that still reproduce the same stall and load failure.

## Primary implementation surface

- execution-loop

## Behavior

- Each diff-derived mutation candidate runs only the co-located killing test file (`bun test <relative-test-path>`), not the aggregate CI union for the whole diff or `classifyChangedPaths` on the mutated production path.
- Changed registered-prompt render checks use the same per-artifact minimal test-file scope, not the whole-diff union.
- Post-write diff-derived verification stays within the existing `MAX_VERIFICATION_MS` wall bound and settles the run out of `in-progress` instead of stalling finalization under load.
- The verifier bounds total concurrent `bun test` work it launches so a verification pass cannot stack dozens of full-suite processes.

## Decisions

- Resolve per-candidate scope by mapping the mutated production path to its co-located `*.test.ts` killing test and invoking only that file via `bun test`; rules out `classifyChangedPaths` on the whole diff or on the production path (the latter still fans `shared/**` to the full v1+v2+shared script union). Changed registered prompts resolve to only the render-observer test file(s) for that prompt.
- Retain post-write `MAX_VERIFICATION_MS` as the verifier wall bound; verification runs only after `executeWrite` clears the iteration watchdog (`publishCompletionArtifacts` → `runReadyFinalizer` → `verifyDiffDerivedMutations` on main); rules out coupling this cost fix to write-iteration ceiling accounting.
- Cap total verifier-launched test concurrency with module constant `MAX_CONCURRENT_VERIFIER_TEST_RUNS` in `diff-derived-mutation-verifier.ts` (alongside `MAX_INSPECTED_MUTATIONS` and `MAX_VERIFICATION_MS`); rules out unbounded parallel full-suite fan-out during verification.
- Leave checkpoint `@mutate` verification semantics unchanged; rules out coupling this cost fix to [[retire-mutation-checkpoint-dsl]].

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `"completes shared multi-candidate verification within MAX_VERIFICATION_MS"` drives diff-derived verification over a `shared/**` diff with multiple mutation candidates and proves the pass finishes before the post-write deadline; it fails against the pre-fix per-candidate full-union re-run behavior.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` structurally pins that each candidate invokes only the co-located killing test file, not unaffected surface suites or aggregate diff scope; it fails when aggregate diff scope is reused per candidate.
- [ ] `v2/src/execution/ready-finalize.test.ts` `"settles finalization after diff-derived verification on a shared multi-candidate diff"` proves ready finalization completes and the durable row leaves `in-progress` without `iteration_timeout`; it fails against the pre-fix path where post-write verification load strands finalization.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `"caps concurrent bun test invocations at MAX_CONCURRENT_VERIFIER_TEST_RUNS"` proves total launched test concurrency stays within the verifier module constant; it fails against the pre-fix unbounded fan-out.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — diff-derived ready-finalization mutation verification uses per-candidate killing-test-file scope, per-prompt render-observer scope, `MAX_CONCURRENT_VERIFIER_TEST_RUNS`, and post-write `MAX_VERIFICATION_MS` timing separate from checkpoint `@mutate` verification.
- `v2/docs/operator-runbook.md` — note `shared/**`-scope verification cost, that a correct implement can still stall in post-write diff-derived verification (distinct from checkpoint `@mutate` iteration-wall wiring), and how to salvage the worktree.
- `v2/docs/v1-behaviors.md` — record the narrowed per-candidate diff-derived verification scope and verifier concurrency bound.
