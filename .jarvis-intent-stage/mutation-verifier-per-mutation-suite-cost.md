---
name: mutation-verifier-per-mutation-suite-cost
---

# Diff-derived mutation verification stays within post-write budget

## Prerequisites

## Problem

- Ready-finalization diff-derived mutation verification classifies the whole production diff once and re-runs the full CI union per candidate; on `shared/**` diffs that fans to multiple full-suite `bun test` invocations per mutation and blows the implement iteration ceiling after the agent has already written correct code.

Unsplit rationale: Per-candidate suite scoping, write-iteration ceiling accounting, and verifier concurrency all live on the diff-derived mutation verification and write-loop execution boundary; splitting would ship partial fixes that still reproduce the same timeout and load failure.

## Primary implementation surface

- execution-loop

## Behavior

- Each diff-derived mutation candidate runs only the minimal package script scope that owns its co-located killing test, not the aggregate CI union for the whole diff.
- Diff-derived and ready-finalization verification wall-clock is excluded from the write-iteration ceiling (or carries its own bounded budget) so post-write machinery cannot settle `iteration_timeout` while the agent is already done.
- The verifier bounds total concurrent `bun test` work it launches so a verification pass cannot stack dozens of full-suite processes.

## Decisions

- Resolve per-candidate scope from the mutated production path to its co-located killing test's owning suite script; rules out reusing aggregate `classifyChangedPaths` over the whole diff for every candidate.
- Treat ready-finalization mutation verification as post-write machinery outside write-iteration ceiling accounting; rules out charging verifier wall-clock against the agent iteration watchdog that already cleared.
- Cap total verifier-launched test concurrency with a shared worker budget across the verification pass; rules out unbounded parallel full-suite fan-out during verification.
- Leave checkpoint `@mutate` verification semantics unchanged; rules out coupling this cost fix to [[retire-mutation-checkpoint-dsl]].

## Acceptance criteria

- [ ] A regression test drives diff-derived verification over a `shared/**` diff with multiple mutation candidates and proves the pass completes within the configured iteration ceiling; it fails against the pre-fix per-candidate full-union re-run behavior.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` structurally pins that each candidate invokes only the minimal suite script(s) containing its co-located killing test, not unaffected surface suites; it fails when aggregate diff scope is reused per candidate.
- [ ] A write-loop or ready-finalization regression test proves diff-derived verification wall-clock is excluded from write-iteration ceiling accounting; it fails against the pre-fix path where verification time still counts toward `iteration_timeout`.
- [ ] A diff-derived verifier regression test proves total launched test concurrency stays within the configured shared worker budget; it fails against the pre-fix unbounded fan-out.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — diff-derived mutation verification uses per-candidate minimal suite scope, a bounded verifier concurrency budget, and post-write timing separate from the write-iteration ceiling.
- `v2/docs/operator-runbook.md` — note `shared/**`-scope verification cost, that a correct implement can still stall in post-write verification, and how to salvage the worktree.
