---
name: shared-invocation-cursor-agent
---

# Wire real `cursor` spawning into shared invocation

Extend `createResolvedAgentBinding`'s dispatch so a `cursor` binding spawns the
real `cursor` CLI (ported from `v1/src/agents/cursor.ts`) with `adapterModel`
and classifies its result into `ok | quota | model_config | error`, reusing
the shared spawn loop and quota heuristics. Cursor-specific token estimation
parity is best-effort, not required.

## Decisions

- Reuse the shared spawn loop and quota classification already ported;
  cursor-only argv/stdio building is new, the process lifecycle handling is
  not.
- `invocation_completed` rows emit on real subprocess settle for `cursor`
  bindings with real agent/model metadata.
- With `claude`, `codex`, `cursor` all wired, `createResolvedAgentBinding` has
  no remaining agent ids that fall through to the terminal-error stub for v2's
  default machine profiles.

## Prerequisites

- shared spawn loop and quota classification are ported into `shared/invocation/agents.ts` (claude slice)
- `createResolvedAgentBinding` dispatches per `agentId` with a stub fallback for unhandled agents
- v1 `cursor` spawn + quota classification exists in `v1/src/agents/cursor.ts`, `cursor-tokens.ts` as a porting reference
