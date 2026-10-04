---
name: role-model-two-axis-resolution
---

# Resolve a workflow step's role to a flat agent/model binding list

Given a step's `role`, the outer `agents` order, and the loaded
`AgentModelConfig`, build the flat ordered binding list `shared/invocation/execute.ts`
consumes, per the two-axis resolution and flat-binding-construction algorithm
in `v2/docs/agent-model-config.md`.

Decisions:
- Outer agent loop advances only on `quota`; role never reorders agents.
- Inner rung loop advances only on `quota`, no no-progress escalation at the model axis.
- Per-role consumption mode: full-list for `plan`/`implement`/`adversary`/`advocate`/`adjudicator`; head-only (`rungs[0]` only) for `actuator`.
- Each outer landing resets to `rungs[0]` — no global rung index across agents.
- `model_config` and `error` outcomes are terminal immediately: no inner advance, no outer advance.
- No retired category taxonomy (`thinking`/`reviewing`/`executing`) anywhere in this resolution path — roles only.

## Prerequisites

- AgentModelConfig loads from the global data file with load-time validation
- Per-machine agent fallback order loads from project config
