---
name: shared-invocation-codex-agent
---

# Wire real `codex` spawning into shared invocation

Extend `createResolvedAgentBinding`'s dispatch so a `codex` binding spawns the
real `codex` CLI (ported from `v1/src/agents/codex.ts` + `codex-session.ts`)
with `adapterModel` and classifies its result into
`ok | quota | model_config | error`, reusing the shared spawn loop and quota
heuristics landed for `claude`.

## Decisions

- Reuse the shared spawn loop and quota classification ported in the `claude`
  slice; do not re-port or duplicate that infra.
- `invocation_completed` rows emit on real subprocess settle for `codex`
  bindings with real agent/model metadata.
- Unrecognized agents (`cursor`) keep returning the current terminal-error
  stub.

## Prerequisites

- shared spawn loop and quota classification are ported into `shared/invocation/agents.ts` (claude slice)
- `createResolvedAgentBinding` dispatches per `agentId` with a stub fallback for unhandled agents
- v1 `codex` spawn + quota classification exists in `v1/src/agents/codex.ts`, `codex-session.ts` as a porting reference
