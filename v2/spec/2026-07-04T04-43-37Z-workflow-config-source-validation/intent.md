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

- Unconfirmed prerequisite: `v2/src/config/agent-model-config.ts` validates a caller-supplied file path, but the repo does not yet show a shipped consumer that loads a concrete harness-global data file.
- Unconfirmed prerequisite: current write/run-start agent selection still resolves from CLI `--agents` or `DEFAULT_WRITE_AGENTS` (`["claude"]`); no shipped per-machine config loader is present in code or durable docs.
