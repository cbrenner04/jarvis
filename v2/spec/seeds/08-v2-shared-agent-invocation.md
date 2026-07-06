---
name: v2-shared-agent-invocation
---

# Wire real agent subprocesses into shared invocation

Replace `createResolvedAgentBinding` / `createAgentBindings` terminal-error stubs with real `claude`, `codex`, and `cursor` spawning and quota classification at the `shared/invocation` seam. v2 becomes capable of doing real work through `jarvis write`, daemon runs, and workflows.

## Decisions

- **Port, don't import v1:** `v2/**` cannot import `v1/**`. Move or re-home spawn + quota classification into `shared/` (or duplicate minimally with a follow-up dedupe). v1 agents remain until a later v1→shared migration slice.
- **Binding seam:** `createResolvedAgentBinding({ agentId, adapterModel, priceKey })` invokes the correct adapter CLI with `adapterModel`, classifies stderr/exit into `ok | quota | model_config | error` per `shared-invocation.md` and v1 quota heuristics.
- **Coverage:** at minimum `claude`, `codex`, `cursor` for v2's default machine profiles. `opencode` optional in same slice if low incremental cost.
- **Quota fallback:** preserve two-axis behavior — outer agent advance and inner rung advance on `quota` only; terminal `model_config`/`error` unchanged.
- **Telemetry:** `invocation_completed` rows emit on real subprocess settle with agent/model metadata from binding.
- **Tests:** unit tests with faked spawn where agent-runnable tests are impractical; at least one integration-style test with injected binding proving the production factory is wired (sandbox agent fixtures acceptable).
- **Idle/liveness:** full `invocation-liveness.md` enforcement may trail this slice; do not block first live agent on watchdog parity — pin follow-up if deferred.
- **Docs:** `shared-invocation.md`, `write-behavior.md` — remove "not wired yet" prose when satisfied.

## Absorbed from shrink plan

- Delete `normalizeBindings`/`hasLiveBindings` runtime introspection (daemon.ts) once production paths resolve bindings from (agent, role, profile) — normalize explicitly at the two deserialization points (start params, queued-input rehydration) instead.
- Unblocks real paused-run `resume` (seed 02 changed the placeholder to reject `not_implemented`; bindings become reconstructable from role + machine profile). Implement here or pin a follow-up seed.

## Out of scope

- v1 agent module deletion or v1 switching to shared adapters.
- Cursor-specific token estimation parity (best-effort ok).
- Phase 8 PR/commit automation.

## Prerequisites

- `shared/invocation/execute.ts` quota fallback loop exists.
- `resolveInvocationBindings` produces flat binding lists from machine profile + role.
- Write loop and daemon call `createResolvedAgentBinding` on production paths (daemon may still use bare `createAgentBindings` on some paths — unify in this slice).

## Ordering

08 — after 06 (rungs resolve from `config/machines/`); can start in parallel with 07 if tests use injected bindings until merge. Unblocks dogfooding.
