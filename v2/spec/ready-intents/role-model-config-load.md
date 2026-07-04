---
name: role-model-config-load
---

# Load the global role→model store with load-time validation

v2/src gains a loader for the harness-global `AgentModelConfig` data file
(`(agent, role) → ModelEscalation`), per `v2/docs/agent-model-config.md`.

Decisions:
- Required roles = closed `Role` union minus `operator`; missing `(agent, role)` for a project-configured agent is a hard load error, not a fallback.
- `operator` entry absent at load is not an error; resolving it before Phase 9 is a runtime error.
- `rungs` missing or empty for any present `(agent, role)` is a hard load error.
- Load validation applies only to agents listed in the project's `agents` order; extra agents in the global file are ignored.
- On-disk filename for the global data file is decided now (first consumer, per `agent-model-config.md`).
- `Model`/`priceKey` existence checks against the adapter catalog and `prices.json` stay deferred — not this slice.

## Prerequisites
