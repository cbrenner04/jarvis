---
name: shared-invocation-claude-agent
---

# Wire real `claude` spawning into shared invocation

`createResolvedAgentBinding` in `shared/invocation/agents.ts` currently returns a
terminal `error` stub for every agent. Port the agent-agnostic subprocess spawn
loop and stderr/exit-code quota classification into `shared/` (from
`v1/src/agents/spawn.ts` + `quota.ts`), then wire the `claude` case so the
binding spawns the real `claude` CLI with `adapterModel` and classifies its
result into `ok | quota | model_config | error`.

## Decisions

- Port, don't import: `shared/**` cannot import `v1/**`. Move/duplicate the
  spawn loop and quota heuristics; v1 keeps its own copies until a later
  v1→shared migration.
- `createResolvedAgentBinding` dispatches on `agentId`; unrecognized agents
  keep returning the current terminal-error stub (codex/cursor land in later
  intents).
- `invocation_completed` rows emit on real subprocess settle for `claude`
  bindings, carrying real agent/model metadata, using the existing telemetry
  hook in `shared/invocation/execute.ts`.
- Two-axis quota fallback (outer agent, inner rung) already lives in
  `execute.ts`; this intent only makes the `claude` binding return real
  `quota`/`model_config`/`error` classifications, not new fallback logic.

## Prerequisites

- `shared/invocation/execute.ts` quota fallback loop iterates ordered bindings by `shouldAdvance`
- `createResolvedAgentBinding` exists as a stub seam in `shared/invocation/agents.ts`
- v1 `claude` spawn + quota classification exists in `v1/src/agents/claude.ts`, `spawn.ts`, `quota.ts` as a porting reference
