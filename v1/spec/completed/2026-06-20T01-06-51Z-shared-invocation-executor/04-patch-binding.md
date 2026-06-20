# 04 - Patch iteration loop adopts the shared binding

## Problem

`v1/src/modes/patch/run.ts` spawns the head agent and classifies its result inline (`agent.run` → `applyQuotaFallbackWhenAllowed` with the "no iteration progress" guard, then `activeAgents.shift()` on quota). With plan/review/shrink now on the shared binding (00–03), patch is the last path still calling spawn+classify outside the 00 factory. Because patch's `noIterationProgress` guard is computable only after the iteration body, patch uses 00's **separable** spawn and classify steps (per the 00 contract): it calls spawn, runs its iteration body, then classifies with its guard thunk — no `executeWithQuotaFallback`, no second classification path. This is a near-no-op: patch already calls `agent.run` and `applyQuotaFallbackWhenAllowed`, so it gains shared spawn-option/classify plumbing only, not new fallback unification.

## Decisions

- Patch uses 00's separable spawn and classify steps for a single invocation per iteration but keeps its cross-iteration advancement; it does **not** call `executeWithQuotaFallback`. Rules out forcing patch's iteration loop into the executor's single-call loop, which risks the messages-unchanged signal.
- Patch supplies its `allowLenientWeakQuotaFallback` = "no iteration progress" (no checked criteria and no worktree edits) guard thunk to the shared classify step, distinct from plan/review/shrink guards. Rules out a patch-only second classification path.
- Patch keeps emitting its own `HARNESS_QUOTA_FALLBACK_STRICT` / `harnessQuotaFallbackLenientLine` and `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED` lines and exit codes (`2`, `3`, `4`); only the spawn+classify call is shared. Rules out moving patch's iteration-aware stderr/exit handling into the binding.

## Acceptance criteria

- [x] Quota exhaustion across all configured patch agents during a run falls through agent-by-agent and exits `2` with the existing `all agents quota-exhausted` line.
- [x] Strict quota and lenient probable-quota fallback stderr lines and the no-progress (`exit 4`) / model_config (`exit 3`) paths are byte-identical to current patch output under `strict` and `lenient`.
- [x] Per-iteration patch telemetry (kind, exitReason for quota-fallback / quota-exhausted / probable-quota-fallback) is unchanged.
- [x] Patch retains head-agent-per-iteration advancement interleaved with watchdog/completion/prompt-rebuild (no behavior change beyond sharing the spawn+classify call).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: note patch shares the spawn+classification binding while retaining its iteration-driven loop.
- `v2/docs/v1-behaviors.md`: record that plan/review/shrink now route their quota-fallback loop through the shared `executeWithQuotaFallback` over v1 bindings, while patch shares only the spawn+classify call (no executor loop) and keeps its iteration-driven advancement; operator messages, telemetry, and exit codes unchanged.
