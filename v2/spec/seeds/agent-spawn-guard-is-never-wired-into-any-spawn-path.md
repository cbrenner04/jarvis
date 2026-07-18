---
name: agent-spawn-guard-is-never-wired-into-any-spawn-path
---

# The agent-spawn capacity guard is defined but never wired into any spawn path (no-op)

## Problem

A capacity guard to prevent the `E2BIG` at ~high worktree counts was implemented (PR #1730,
deferred/not-merged) with a real mechanism and real module, but **`createPreSpawnGuard()` has zero
production callers**. The three v2 spawn paths — `runWriteStep` (`v2/src/execution/write.ts`),
`invokeRole` (`v2/src/execution/review-cycle.ts`), and `v2/src/execution/review-debate.ts` — all
call `executeWithQuotaFallback(...)` with **no** `preSpawnGuard`. So the guard fires against nothing
in production; a real v2 run at high worktree counts still burns quota then hits `E2BIG`. Mutation
review confirmed it (grep of `v2/**`/`shared/**` excluding tests finds only the definition site).
The tests inject a stub guard directly / call the module functions directly, so the green gate +
6/6 ticked AC certified a no-op. (3rd mock-hidden no-op of the 2026-07-17 session.)

## Decisions

- Construct the guard from the run's registry/runner/daemon/store/config and thread it into
  `runWriteStep`, `review-cycle`, and `review-debate` (every production role incl. fallback,
  review, revision, re-prompt); rules out an inert `preSpawnGuard?` field with no caller.
- Add a **workflow-path** test that drives a REAL spawn (not an injected stub guard) at/above the
  refuse threshold and asserts the spawn is blocked and no quota is spent; rules out mock-only
  coverage that certifies a no-op.
- Also fix the 00-seam regressions the review flagged: `jarvis cleanup` error reporting moved from
  stderr+detail to a generic stdout skip line, the dropped `could not delete local branch` warning,
  and double discovery per invocation.

## Prerequisites

- Re-uses the extracted non-interactive retirement seam from the agent-spawn spec's subspec 00.

## Documentation updates

- `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md` — the guard actually runs before every
  v2 spawn once this ships.
