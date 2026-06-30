---
name: intent-agent-order-override-flag
---

# Per-run `--agent` override for `jarvis1 intent`

## Problem

Intent-split runs (`jarvis1 intent`) read `modes.plan.agentOrder` for the split pass. Without a flag, seed-to-intent authoring experiments require the same config churn as plan.

## Desired behavior

`jarvis1 intent` accepts repeatable `--agent` with the same syntax and validation as `jarvis1 plan`. When present, the intent-split actuator cascade uses the overridden `modes.plan.agentOrder` for that invocation only; config on disk is unchanged.

## Decisions

- Reuse the shared `--agent` parse/validate/apply path from plan mode — rules out intent-only flag semantics.
- Scope is intent-split actuation only; no new plan pipeline phases — rules out expanding `jarvis1 intent` beyond the existing command.

## Documentation updates

- `v1/docs/agents.md` — extend `--agent` coverage to `jarvis1 intent`.

## Prerequisites

- Repeatable `--agent` values parse and validate into an `agentOrder` with the same rules as config, without persisting config
- `jarvis1 plan` honors per-run `--agent` override of `modes.plan.agentOrder`

## Blocker

- No shared repeatable `--agent` CLI parse/validate/apply path in committed code (`v1/src/commands/plan-args.ts`, `v1/src/cli.ts`, or shared helper); ready-intent `agent-order-override-flag` is unimplemented.
- `jarvis1 plan` does not accept or honor `--agent`; `modes.plan.agentOrder` is read directly from config in plan actuators (`intent-split.ts`, `draft.ts`, etc.).
