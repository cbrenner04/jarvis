---
name: per-run-agent-override-flag
---

# Per-invocation agent/model override for plan & run

To experiment with a specific actuator (e.g. opencode/deepseek vs cursor vs
opencode/glm-5.2) for one `jarvis1 plan`/`jarvis1 run`, the operator must hand-edit the
global `~/.jarvis/config.json` `agentOrder`, run, then revert — global churn that also
risks leaving the live config in an experimental state. There is no per-invocation
override flag.

Observed 2026-06-29: comparing DeepSeek V4 Flash Free against cursor as the plan
actuator required reordering `modes.plan.agentOrder` by hand for a single plan run.

Add a flag (e.g. `--agent <name>` / `--agent <name>:<model>`, repeatable to express a
one-off order) that overrides the resolved `agentOrder` for that invocation only,
without touching the persisted config.

## Decisions

- Flag overrides the effective `agentOrder` for the single invocation; persisted config
  is untouched — rules out a flag that writes config.
- Accept `agent` or `agent:model`; an unpriced/unknown model fails the same validation
  as config (`resolveAgentPriceKey`/known-agent checks) — rules out a bypass that lets
  invalid entries run.
- Repeatable to express a full one-off cascade (`--agent opencode:opencode/glm-5.2
  --agent cursor`) — rules out a single-agent-only flag that loses fallback.
- Applies to `plan` and `run` (and `intent` if cheap) — rules out plan-only scope that
  still forces config churn for impl experiments.

## Out of scope

- Sub-role (`reviewPanel`/`reviewActuator`) per-run overrides — start with top-level
  `agentOrder`; add sub-role flags only if a consumer needs them.
- Persisting experiment results / cost comparison tooling.

## Documentation updates

- `v1/docs/agents.md` and/or `v1/docs/config.md` — document the override flag.
- `v1/docs/operator-runbook.md` — note the flag in the experimentation section so the
  operator stops hand-editing config for one-off model tests.
