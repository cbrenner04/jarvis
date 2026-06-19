---
name: shared-invocation-executor
---
# Shared invocation executor for quota fallback

**Scope.** Route patch/plan/review/shrink agent invocations through `shared/invocation/execute.ts` with v1 spawn bindings.

## Problem

`shared/invocation/execute.ts` exists but v1 reimplements quota fallback in three places (patch, plan, review/shrink paths).

## Desired behavior

All v1 agent invocations with quota fallback route through the shared executor plus v1-specific spawn bindings. Per-mode call sites delegate classification, fallback order, and retry semantics to one implementation.

## Decisions

- Shared executor owns quota fallback loop semantics; v1 supplies spawn/bindings only. Rules out a fourth parallel fallback implementation in a new mode.
- Patch, plan, review, and shrink all use the same executor entry point. Rules out leaving one mode on legacy inline fallback.
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
