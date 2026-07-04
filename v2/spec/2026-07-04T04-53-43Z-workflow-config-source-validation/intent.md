---
name: workflow-config-source-validation
---

# Validate workflow step roles against the loaded config at load time

A workflow definition (source) names a role per step; the config-vs-source
validation check confirms, at workflow load time, that every step's role
resolves for every configured agent (per the load-time validation rules in
`v2/docs/agent-model-config.md`) before the workflow is allowed to run.

Decisions:
- A step naming a role with no `(agent, role)` entry for a project-configured agent is a hard load error, surfaced with the offending step and role — not deferred to first invocation.
- This check runs once at workflow load, not per-step at invocation time.

## Prerequisites

- AgentModelConfig loads from the global data file with load-time validation
- Per-machine agent fallback order loads from project config
- A workflow runner executes a linear array of role-bound steps

## Blocker

- Unconfirmed prerequisite: committed v2 code/docs load the fallback agent order from machine config `~/.jarvis/v2.json` (`v2/src/config/machine-config-loader.ts`, `v2/docs/agent-model-config.md`, `v2/docs/write-behavior.md`), not from project config.
