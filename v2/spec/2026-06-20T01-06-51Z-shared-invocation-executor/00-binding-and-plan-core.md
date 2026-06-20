# 00 - Shared spawn+classification binding; plan core paths route through executor

## Problem

`shared/invocation/execute.ts` (`executeWithQuotaFallback`) exists but no path uses it. Plan's single-call paths (`draft.ts`, `intent-draft.ts`, `name-only.ts`) each reimplement the same inline loop: iterate `modes.plan.agentOrder`, spawn, snapshot git porcelain before/after, classify via `applyQuotaFallbackWhenAllowed`, emit per-rotation stderr via `emitPlanAgentQuotaFallback`, record per-attempt telemetry, advance on `quota`. This subspec establishes the shared spawn+classification seam and migrates those three paths.

## Decisions

The binding seam is pinned here against **all four** consumers (plan single-call, plan structured 01, review 02, shrink/patch 03–04), so 01–04 are additive migrations, not re-openings of 00. The four consumers diverge on these axes; the factory contract must absorb each:

- Binding lives in `v1/**` (wraps `agent.run` + classification), producing `InvocationBinding`s the shared executor loops over. Rules out moving agent-CLI/classification knowledge into `shared/**` (forbidden import direction).
- **Per-consumer stderr emitter, injected — not owned by the binding.** Emitters differ per path (`plan:`, `intent:`, shrink/review's `${agent.name}:` + `result.stderr` passthrough) and review emits none (it fires `onQuotaRotation`). The factory takes the rotation emitter as a parameter; a single internal `emitPlanAgentQuotaFallback` cannot meet the byte-identical-stderr criteria across paths. Rules out hardcoding plan's emitter in the shared binding.
- **Per-consumer telemetry sink, injected.** Plan paths call `recordAgentAttempt`; intent-split records no per-attempt telemetry; shrink/patch/review write `patch_phase` rows. The factory takes a per-attempt telemetry callback (no-op for intent-split); the binding does not own a single telemetry shape. Rules out "the binding always calls `recordAgentAttempt`".
- **Per-consumer spawn options, closed over by the factory; `invoke({prompt,cwd,signal})` stays narrow.** `additionalReadDirs` (draft/review/verdict-actuator) and watchdog wiring + `abortKillGraceMs` (patch/shrink) are not in `invoke`'s args. The factory captures per-consumer spawn options so `invoke` keeps its existing signature. Rules out widening `invoke`'s signature per path.
- **Per-rotation side effects run inside `invoke`, before the spawn.** intent-split's `resetIntentStageDir` must execute before each agent's spawn; the factory accepts a per-rotation pre-spawn hook (no-op where unused). Rules out 01 regressing fan-out by running the reset once outside the loop.
- **Spawn and classification are separable steps, not a coupled `invoke`.** Patch's guard (`noIterationProgress` = no checked criteria and no worktree edits) is computable only *after* the iteration body, so a binding whose `invoke` couples spawn→porcelain→classify cannot serve patch. The factory exposes spawn and `applyQuotaFallbackWhenAllowed` classification as distinct steps (classification driven by a guard thunk supplied per consumer): plan/review/shrink wire them together inside one `invoke`; patch (04) calls spawn then classifies after its iteration body, with no second classification path. This is the headline structural decision — pinned here, not deferred. Rules out a coupled `invoke` that 04 must reshape, and rules out a patch-only parallel classification path.
- **Executor stays generic over `T extends InvocationResult` and returns the ok result untouched.** `InvocationOk` is only the default; a binding may return an ok variant carrying `usage`/`cost_usd`, which the executor passes through — cost/usage do not vanish through the seam. Rules out the impression that the seam flattens rich ok results.
- **Empty `agentOrder` is mapped by the caller, not the executor.** The executor returns `final: null` for an empty binding list uniformly; each caller reproduces its existing empty-order outcome: intent-draft → `model_config` with its current `plan:` message; intent-split → `model_config` with `intent: modes.plan.agentOrder is empty`; other paths fall to their existing defensive exit-2 path. Rules out collapsing the distinct empty-order messages into one.
- Caller maps `execution.final` to the path's existing return/throw shape and emits the terminal `all agents quota-exhausted` message; the executor does not know "last agent". Rules out duplicating exhaustion-message logic per binding.
- `emitPlanAgentQuotaFallback` and the strict/lenient harness message helpers are reused unchanged. Rules out new message phrasing.

## Task checklist

- Add a v1 spawn+classification binding factory consumed by `executeWithQuotaFallback`, parameterized over: rotation-stderr emitter, per-attempt telemetry sink, spawn options, per-rotation pre-spawn hook, and a classification guard thunk — with spawn and classification exposed as separable steps for patch (04).
- Migrate `draft.ts`, `intent-draft.ts`, `name-only.ts` to build bindings and call the shared executor; delete their inline fallback loops.
- Preserve each path's success/quota/error/model_config return shape (including empty-`agentOrder` messages), stderr lines, and `recordAgentAttempt` telemetry.
- Update `v1/docs/agents.md` to describe the shared-executor invocation path.

## Acceptance criteria

- [ ] Quota exhaustion across all configured plan agents during draft, intent-draft, and name-only falls through agent-by-agent and ends in the existing all-agents-exhausted outcome.
- [ ] Strict quota and lenient probable-quota stderr lines emitted during those three plan paths are byte-identical to current output for both `quotaFallback: "strict"` and `"lenient"`.
- [ ] Per-attempt plan telemetry (phase, agent, configured model, result kind) for those paths is unchanged.
- [ ] `model_config` and terminal `error` results stop the fallback chain (no advance to the next agent) in those paths.
- [ ] Empty `modes.plan.agentOrder` yields each path's existing message unchanged (intent-draft's `plan:` model_config message; the other single-call paths' defensive outcome).
- [ ] `shared/**` contains no import from `v1/**` or `v2/**`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: note that plan invocations route through the shared `executeWithQuotaFallback` over v1-supplied bindings.
