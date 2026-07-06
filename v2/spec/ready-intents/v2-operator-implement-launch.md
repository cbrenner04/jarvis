---
name: v2-operator-implement-launch
---

# Operator surface to launch an `implement` workflow run

Add an operator entry point (e.g. `jarvis run workflow implement`) that resolves the target project from cwd against the `~/.jarvis/config.json` registry, accepts the run's required args (spec path, branch/base), builds the workflow via the `implement` preset + `loadWorkflowSteps`, and starts it through the daemon — so operators stop hand-assembling `WriteLoopInput` flags for an implement run.

## Decisions

- Project resolution reuses the v1 registry-matching rules (`v1/src/resolve-project.ts`) where applicable, not a parallel v2 scheme.
- Thinner than `jarvis write`: the preset supplies topology, prompt id, and default `stepRules`/contract; the operator does not pass `--agents` (agent/model selection stays machine-config-owned). Document which flags remain per-run vs preset-owned.
- Uses machine profile config for agent/model resolution (or the interim global file if machine profiles haven't landed yet).

## Prerequisites

- `implement` workflow preset exists.
- Daemon `start` accepts a workflow-shaped input (ordered `steps[]`), not only a bare `WriteLoopInput`.
- Machine profile (or interim global) config for agent/model resolution exists.
- `loadWorkflowSteps` assembles `agents`/`agentModelConfig` for authored workflow steps.

## Out of scope

- Full `plan` or `yolo` presets.
- PR lifecycle.
- TUI workflow launcher.
- Per-project workflow enablement.
