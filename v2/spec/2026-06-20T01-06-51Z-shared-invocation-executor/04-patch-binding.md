# 04 - Patch iteration loop adopts the shared binding

## Problem

`v1/src/modes/patch/run.ts` spawns the head agent and classifies its result inline (`agent.run` → `applyQuotaFallbackWhenAllowed` with the "no iteration progress" guard, then `activeAgents.shift()` on quota). With plan/review/shrink now on the shared binding (00–03), patch is the last path with its own spawn+classification copy. Patch must share the same spawn+`applyQuotaFallbackWhenAllowed` binding while keeping its iteration-driven fallback (head agent per iteration, `shift()` on quota, interleaved with watchdogs/completion/prompt-rebuild).

## Decisions

- Patch reuses the 00 spawn+classification binding for a single invocation per iteration but keeps its cross-iteration advancement; it does **not** call `executeWithQuotaFallback`. Rules out forcing patch's iteration loop into the executor's single-call loop, which risks the messages-unchanged signal.
- The 00 binding factory accepts patch's `allowLenientWeakQuotaFallback` = "no iteration progress" (no checked criteria and no worktree edits), distinct from plan/review/shrink guards. Rules out a patch-only second classification path.
- Patch keeps emitting its own `HARNESS_QUOTA_FALLBACK_STRICT` / `harnessQuotaFallbackLenientLine` and `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED` lines and exit codes (`2`, `3`, `4`); only the spawn+classify call is shared. Rules out moving patch's iteration-aware stderr/exit handling into the binding.

## Acceptance criteria

- [ ] Quota exhaustion across all configured patch agents during a run falls through agent-by-agent and exits `2` with the existing `all agents quota-exhausted` line.
- [ ] Strict quota and lenient probable-quota fallback stderr lines and the no-progress (`exit 4`) / model_config (`exit 3`) paths are byte-identical to current patch output under `strict` and `lenient`.
- [ ] Per-iteration patch telemetry (kind, exitReason for quota-fallback / quota-exhausted / probable-quota-fallback) is unchanged.
- [ ] Patch retains head-agent-per-iteration advancement interleaved with watchdog/completion/prompt-rebuild (no behavior change beyond sharing the spawn+classify call).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: note patch shares the spawn+classification binding while retaining its iteration-driven loop.
- `v2/docs/v1-behaviors.md`: record that quota fallback spawn+classification is unified across patch/plan/review/shrink — plan/review/shrink loop via the shared executor, patch shares the binding only; operator messages, telemetry, and exit codes unchanged.
