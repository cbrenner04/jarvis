---
name: plan-agent-order-override-flag
---

# Per-run `--agent` override for `jarvis1 plan`

## Problem

Plan actuator experiments (e.g. opencode/deepseek vs cursor for one `jarvis1 plan`) still require hand-editing `modes.plan.agentOrder` when patch override is unavailable or the operator is only planning.

## Desired behavior

`jarvis1 plan` accepts the same repeatable `--agent` flag as patch run. When present, every plan-mode actuator phase that reads `modes.plan.agentOrder` (draft, intent-draft, name-only, verdict-actuator, plan PR narrative agent, quota cascade) uses the overridden order for that invocation only. Persisted config is untouched. Plan review adversary/advocate/adjudicator resolution stays on `modes.review.agentOrder ?? modes.plan.agentOrder` without a separate sub-role flag — rules out review-panel per-run overrides here.

## Decisions

- Reuse the shared `--agent` parse/validate helper from patch run — rules out a second incompatible parser.
- Override applies to all plan actuators that consume `modes.plan.agentOrder`, not draft-only — rules out a draft-phase-only experiment hook.
- Plan review panel order is not independently overridable — rules out `--review-agent` scope creep from the seed.

## Documentation updates

- `v1/docs/agents.md` — extend `--agent` coverage to `jarvis1 plan`.
- `v1/docs/operator-runbook.md` — experimentation section: use `--agent` instead of config surgery for one-off plan actuator tests.
- `v2/docs/v1-behaviors.md` — plan mode honors per-invocation `--agent` override of `modes.plan.agentOrder`.

## Prerequisites

- Repeatable `--agent` values parse and validate into an `agentOrder` with the same rules as config, without persisting config
