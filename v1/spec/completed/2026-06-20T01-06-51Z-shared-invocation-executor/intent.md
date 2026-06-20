---
name: shared-invocation-executor
---
# Shared invocation executor for quota fallback

**Scope.** Unify quota-fallback spawn + classification across patch/plan/review/shrink. Plan/review/shrink route through `shared/invocation/execute.ts`; patch shares the spawn + classification binding while keeping its iteration-driven loop.

## Problem

`shared/invocation/execute.ts` exists but v1 reimplements quota fallback in three places (patch, plan, review/shrink paths).

## Desired behavior

Plan, review, and shrink route their agent invocations through the shared executor (plus v1 spawn bindings), delegating classification, fallback order, and retry semantics to one implementation. Patch shares the same spawn + quota-classification binding but retains its iteration-driven fallback loop. Spawn and quota classification have one implementation across all four paths; patch behavior, telemetry, and operator messages stay identical.

## Decisions

- Shared executor owns quota fallback loop semantics; v1 supplies spawn/bindings only. Rules out a fourth parallel fallback implementation in a new mode.
- Plan, review, and shrink use the shared executor's multi-agent loop (one logical invocation, inner loop over `agentOrder`). Rules out leaving those modes on legacy inline fallback.
- Patch keeps its iteration-driven agent advancement (head agent per iteration, `shift()` on quota, interleaved with watchdogs/completion/prompt-rebuild) but shares the same spawn + `applyQuotaFallbackWhenAllowed` quota-classification binding as the executor. Classification and spawn are unified across all four paths without forcing patch's cross-iteration fallback into the single-call loop. Rules out a parallel quota-classification/spawn implementation in patch, and rules out refactoring patch's iteration loop into an executor binding (risks the messages-unchanged signal).
- v1 spawn bindings stay in v1; `shared/**` does not import from `v1/**`. Rules out moving agent CLI knowledge into shared.

## Acceptance signals

- Tests prove quota exhaustion in patch, plan, and review/shrink paths fall through via the shared executor.
- Tests prove strict/lenient harness quota messages unchanged for operators.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: invocation path through shared executor.
- `v2/docs/v1-behaviors.md`: unified quota fallback routing.

## Out of scope

- New quota classification heuristics.
- Changing configured agent fallback order defaults.
- v2 engine invocation.

## Prerequisites
