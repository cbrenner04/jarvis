---
name: agent-order-override-flag
---

# Per-run `--agent` override for `jarvis1 run` and `jarvis1 plan`

## Problem

Patch and plan actuator experiments both require hand-editing `modes.patch.agentOrder` / `modes.plan.agentOrder` in `~/.jarvis/config.json`, running, then reverting — global churn with risk of leaving experimental order live. The same `--agent` flag should work on both `run` and `plan` via one shared parser.

## Desired behavior

`jarvis1 run` and `jarvis1 plan` both accept repeatable `--agent <name>` and `--agent <name>:<model>`. When present, the effective agent order for that invocation is the flag sequence; persisted config is untouched.

- **`jarvis1 run`**: override replaces `modes.patch.agentOrder` for the invocation. Quota, no-progress, idle-timeout, and tier escalation operate on the overridden ladder. Review/shrink `subRoleAgentOrder` stays config-resolved — rules out per-run sub-role overrides in this slice.
- **`jarvis1 plan`**: every plan-mode actuator phase that reads `modes.plan.agentOrder` (draft, intent-draft, name-only, verdict-actuator, plan PR narrative agent, quota cascade) uses the overridden order for that invocation only. Plan review adversary/advocate/adjudicator resolution stays on `modes.review.agentOrder ?? modes.plan.agentOrder` without a separate sub-role flag — rules out review-panel per-run overrides here.

## Decisions

- One shared `--agent` parse/validate helper serves both `run` and `plan` — rules out a second incompatible parser.
- Repeatable `--agent` builds the one-off ladder in flag order — rules out a single-value flag that drops fallback.
- Invalid agent, empty model, unknown/unpriced model, or duplicate agent exits non-zero using the same validation as config `agentOrder` — rules out a lax bypass path.
- Override replaces only the resolved mode's `agentOrder` for the invocation — rules out writing config or overriding the other mode's order, review/shrink sub-role orders, or plan review-panel order.
- Omitted `:model` inherits from the mode's configured `agentOrder` before override; no matching entry requires `:model` — rules out agent-CLI default models.
- `jarvis1 intent` and `jarvis1 prompt` do not get `--agent` in this spec — rules out assuming command parity.

## Documentation updates

- `v1/docs/agents.md` — `--agent` syntax, repeatability, precedence over config `agentOrder`, coverage of both `run` and `plan`, patch-only and plan-only scope boundaries for this slice.
- `v1/docs/config.md` — note per-run override does not mutate persisted order.
- `v1/docs/operator-runbook.md` — experimentation section: use `--agent` instead of config surgery for one-off patch/plan actuator tests.
- `v2/docs/v1-behaviors.md` — patch and plan modes honor per-invocation `--agent` override.

## Prerequisites
