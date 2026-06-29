---
name: run-agent-order-override-flag
---

# Per-run `--agent` override for `jarvis1 run`

## Problem

Patch experiments require hand-editing `modes.patch.agentOrder` in `~/.jarvis/config.json`, running, then reverting — global churn with risk of leaving experimental order live.

## Desired behavior

`jarvis1 run` accepts repeatable `--agent <name>` and `--agent <name>:<model>`. When present, the effective `modes.patch.agentOrder` for that invocation is the flag sequence; persisted config is untouched. Quota, no-progress, idle-timeout, and tier escalation operate on the overridden ladder. Review/shrink `subRoleAgentOrder` stays config-resolved — rules out per-run sub-role overrides in this slice.

## Decisions

- Repeatable `--agent` builds the one-off patch ladder in flag order — rules out a single-value flag that drops fallback.
- Invalid agent, empty model, unknown/unpriced model, or duplicate agent exits non-zero using the same validation as config `agentOrder` — rules out a lax bypass path.
- Override replaces only `modes.patch.agentOrder` for the invocation — rules out writing config or overriding plan/review orders.
- Deferred to first consumer: model resolution when `--agent <name>` omits `:model` — pin when the parser is drafted.

## Documentation updates

- `v1/docs/agents.md` — `--agent` syntax, repeatability, precedence over config `agentOrder`, patch-only scope for this slice.
- `v1/docs/config.md` — note per-run override does not mutate persisted order.
- `v2/docs/v1-behaviors.md` — patch run honors per-invocation `--agent` override.

## Prerequisites
