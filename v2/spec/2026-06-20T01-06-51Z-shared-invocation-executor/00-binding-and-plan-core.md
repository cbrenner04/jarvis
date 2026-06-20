# 00 - Shared spawn+classification binding; plan core paths route through executor

## Problem

`shared/invocation/execute.ts` (`executeWithQuotaFallback`) exists but no path uses it. Plan's single-call paths (`draft.ts`, `intent-draft.ts`, `name-only.ts`) each reimplement the same inline loop: iterate `modes.plan.agentOrder`, spawn, snapshot git porcelain before/after, classify via `applyQuotaFallbackWhenAllowed`, emit per-rotation stderr via `emitPlanAgentQuotaFallback`, record per-attempt telemetry, advance on `quota`. This subspec establishes the shared spawn+classification seam and migrates those three paths.

## Decisions

- Spawn+classification binding lives in `v1/**` (wraps `agent.run` + porcelain guard + `applyQuotaFallbackWhenAllowed`), producing `InvocationBinding`s the shared executor loops over. Rules out moving agent-CLI/classification knowledge into `shared/**` (forbidden import direction).
- The v1 binding owns per-attempt telemetry and per-rotation stderr emission inside `invoke`; the shared executor stays a pure quota-only fallback loop. Rules out threading raw `spawnResult` through the executor's generic result type to reconstruct `emitPlanAgentQuotaFallback`'s strict-vs-lenient wording in the caller.
- Caller maps `execution.final` to the path's existing return/throw shape and emits the terminal `all agents quota-exhausted` message; the executor does not know "last agent". Rules out duplicating exhaustion-message logic per binding.
- `emitPlanAgentQuotaFallback` and the strict/lenient harness message helpers are reused unchanged. Rules out new message phrasing.
- Deferred to first consumer: exact binding factory signature (how `allowLenientWeakQuotaFallback` is supplied) — pin when patch (04) needs the "no iteration progress" guard variant alongside plan's "porcelain unchanged".

## Task checklist

- Add a v1 spawn+classification binding factory consumed by `executeWithQuotaFallback`.
- Migrate `draft.ts`, `intent-draft.ts`, `name-only.ts` to build bindings and call the shared executor; delete their inline fallback loops.
- Preserve each path's success/quota/error/model_config return shape, stderr lines, and `recordAgentAttempt` telemetry.
- Update `v1/docs/agents.md` to describe the shared-executor invocation path.

## Acceptance criteria

- [ ] Quota exhaustion across all configured plan agents during draft, intent-draft, and name-only falls through agent-by-agent and ends in the existing all-agents-exhausted outcome.
- [ ] Strict quota and lenient probable-quota stderr lines emitted during those three plan paths are byte-identical to current output for both `quotaFallback: "strict"` and `"lenient"`.
- [ ] Per-attempt plan telemetry (phase, agent, configured model, result kind) for those paths is unchanged.
- [ ] `model_config` and terminal `error` results stop the fallback chain (no advance to the next agent) in those paths.
- [ ] `shared/**` contains no import from `v1/**` or `v2/**`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: note that plan invocations route through the shared `executeWithQuotaFallback` over v1-supplied bindings.
