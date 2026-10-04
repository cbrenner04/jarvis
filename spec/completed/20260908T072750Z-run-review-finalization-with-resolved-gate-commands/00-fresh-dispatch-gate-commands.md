# 00 - Fresh dispatch gate commands

## Problem

The workflow completion publication tail builds `publishWithReadyRepair` input from the durable write step via `buildCompletionStepWriteLoopInput` even when the last executed step is a review or review-debate row that owns ready-gate finalization. Review-last workflows therefore reach the ready gate with `readyCommand`/`fixCommand` unstamped on the write sibling, resolve `undefined`, and fall back to `bun run ready` after successful write work and publication.

## Decision ledger

- Fresh dispatch reads `fixCommand` and `readyCommand` from the gate-owning workflow step — the last step when its behavior is `review` or `review-debate`, otherwise the completion write step; rules out behavior-based defaulting and borrowing an in-scope write sibling when the review row owns the gate.
- Omit both fields on the publication tail when the gate-owning admitted step carried neither override; rules out materializing built-in defaults onto `WriteLoopInput` and losing configured-versus-default distinction downstream.
- Write-step-owned finalization keeps today's write-step command source; rules out regressing non-review-last workflows.

## Task checklist

- Introduce a shared resolver that maps `(steps, completionStep, isReviewLastStep)` to the gate-owning step's stamped `fixCommand`/`readyCommand`.
- Thread the resolved commands into `buildCompletionStepWriteLoopInput` (or equivalent publication-tail construction) for review-last and review-debate-last workflows.
- Add a review-last workflow regression that stamps a non-bun `readyCommand` on the review step, stubs the finalizer, and asserts the configured command is passed on first dispatch.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-publication.test.ts` proves review-owned finalization for a project configured with a non-bun `readyCommand` invokes that command instead of `bun run ready`; the test fails against the pre-fix write-step-only `buildCompletionStepWriteLoopInput` path reachable on main.
- [x] `v2/src/execution/ready-finalize.test.ts` test `falls back to bun run ready without a configured readyCommand` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to [[04-documentation]].
