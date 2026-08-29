---
name: mutation-verifier-per-mutation-suite-cost
---

# Diff-derived mutation verification blows the iteration ceiling on multi-suite scopes

## Problem

The diff-derived mutation verifier (ready finalization) derives candidates from the run's production diff, applies each, and runs the scoped test suite to require a red. On a `shared/**` diff the scoped suite is the full CI union — `test:v1` + `test:v2` + `test:integration:v2` — each an independent `bun test` invocation that internally fans to ~20 workers (`--max-concurrency=20`). Run once per mutation candidate, inside the write iteration's wall-clock, this exceeds the ~45-minute iteration ceiling: the agent finishes correct code, then the verification loop times the iteration out before it can commit.

## Evidence

- 2026-08-29: `20260829T070117Z-lossless-git-status-inventory` (shared/git.ts, +85/+122). Three consecutive implement runs failed — one machine crash under stacked suite load, then two `iteration_timeout`s at the ~45-min ceiling with the code already written and correct (typecheck, all three suites, both `@mutate` checkpoints red, independent review all green when finished by hand). The mutation loop, not the agent, consumed the budget. Hand-published as #3083.
- Also the load lever behind the machine crash: N concurrent full-suite invocations (verifier + resumes + operator gates), each 20-wide.

## Decisions

- Scope each mutation candidate's verification run to the minimal suite that owns its killing test, not the whole CI union: a mutation in `shared/git.ts` is killed by `shared/git.test.ts`, so re-running `test:v1`/`test:v2`/`test:integration:v2` per mutation is waste. Rules out re-running unaffected suites per mutation.
- Mutation/ready verification is post-write machinery, not agent think-time; its wall-clock must not be charged against the write iteration's idle/iteration ceiling. Rules out a correct-but-slow-to-verify implement timing out as if the agent stalled.
- Bound total `bun test` concurrency the verifier launches (a shared worker budget) so a verification pass cannot fan to dozens of full-suite processes. Rules out the crash-class stack.
- Independent of [[retire-mutation-checkpoint-dsl]], which keeps diff-derived verification unchanged — this is its cost/scoping, not its DSL layer.

## Acceptance criteria

- [ ] A `shared/**` implement whose diff yields multiple mutation candidates completes verification within the iteration ceiling, pinned by a test that fails against the current per-mutation full-union re-run.
- [ ] Each mutation candidate's verification runs only the minimal suite containing its pinning/killing test, pinned structurally.
- [ ] Verification wall-clock is excluded from the write-iteration ceiling accounting (or given its own budget), pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — mutation/ready verification scope and budget separate from the write iteration.
- `v2/docs/operator-runbook.md` — note the shared/**-scope verification cost and that a correct implement can time out in verification (salvage the worktree).
