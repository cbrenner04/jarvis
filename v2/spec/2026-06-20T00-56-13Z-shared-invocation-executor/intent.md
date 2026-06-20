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

## Blocker

The intent decides "patch ... use the same executor entry point," but patch mode's
fallback does not have the shape `executeWithQuotaFallback` models, and forcing it
in risks the "messages unchanged" acceptance signal. I cannot draft a patch subspec
without resolving how patch maps. Plan/review/shrink are unaffected.

What `executeWithQuotaFallback` models (shared/invocation/execute.ts): one logical
invocation, one prompt, try ordered bindings in a single call, advance only on
`quota`, stop on `ok`/`model_config`/`error`.

How plan/review/shrink already work (clean fit): each does ONE logical invocation
with an inner loop over `agentOrder`, same prompt across agents, advancing only on
quota. E.g. `v1/src/modes/plan/draft.ts:156`, `v1/src/modes/review/run.ts:80`
(`runRoleAttempt`), `v1/src/modes/patch/shrink.ts:442`.

How patch differs (no fit): `buildActiveAgents` (`v1/src/modes/patch/run.ts:647`)
builds an ordered `Agent[]`; each *iteration* runs only the head agent
(`activeAgents[0]`). On quota patch does `activeAgents.shift()` then
`state.iteration += 1; return {kind:"continue"}` (`run.ts:1593`, `run.ts:1655`) —
fallback is spread ACROSS iterations, interleaved with the idle/iteration/run
watchdogs, descendant tracking, completion detection, and a per-iteration prompt
rebuild. There is no single-call "try agents in order" loop to route through the
executor. Patch also emits distinct per-iteration telemetry (`quota-fallback`,
`probable-quota-fallback`, `quota-exhausted`) and strict vs. lenient stderr lines
(`HARNESS_QUOTA_FALLBACK_STRICT` vs `harnessQuotaFallbackLenientLine`).

Pick one:

1. Patch keeps its iteration-driven agent advancement, but adopts a shared v1
   *binding* (spawn + `applyQuotaFallbackWhenAllowed` classification) so spawn and
   quota classification are unified across all four paths. Patch does NOT call the
   executor's multi-agent loop (that loop is for plan/review/shrink). This keeps
   patch behavior/telemetry/messages identical. Contradicts the literal "same
   executor entry point" wording but honors the dedup goal and "messages
   unchanged."

2. Refactor patch's iteration loop so a full iteration (build prompt, watchdog,
   run, post-process, classify) is the binding, and the executor drives cross-
   iteration advancement. Large, higher-risk; must prove watchdog/timeout/
   completion semantics and all patch telemetry/stderr unchanged. Confirm this is
   wanted despite the risk to the "messages unchanged" signal.

3. Drop patch from scope for this spec; route only plan/review/shrink now and file
   a separate patch intent.

State which, or revise the intent's patch decision, then re-run plan.
