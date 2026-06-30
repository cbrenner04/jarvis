# Patch `jarvis1 run` override

## Problem

Patch actuator experiments require editing `modes.patch.agentOrder` in config, running, then reverting. Operators need a one-run ladder without mutating persisted order.

## Decisions

- `jarvis1 run` accepts repeatable `--agent` using the shared parser from `00` — rules out run-only flag syntax.
- When any `--agent` is present, replace `modes.patch.agentOrder` in the in-memory config for that invocation only; do not write `~/.jarvis/config.json` — rules out config persistence and rules out touching `modes.plan.agentOrder`.
- Quota, no-progress, idle-timeout, and `--tier` slicing operate on the overridden ladder — rules out tier/quota reading the pre-override config order.
- `modes.patch.subRoleAgentOrder` stays config-resolved; `reviewActuator` fallback to `modes.patch.agentOrder` uses the pre-override config snapshot — rules out review/shrink inheriting `--agent` via the default sub-role fallback path.
- Absent `--agent`, patch behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `jarvis1 run` usage, `cli.ts` parse path, and `ParsedArgs`.
- After `loadConfig`, when override ladder is present, shallow-clone config and substitute `modes.patch.agentOrder`.
- Confirm `buildActiveAgents`, quota/no-progress/idle escalation, and tier start index use the substituted order.
- Pass review-panel and review-actuator orders from pre-override config (or explicit overrides) so sub-role fallback does not read substituted `modes.patch.agentOrder`.
- Tests: override ladder used for implementation iterations; config file unchanged after run; invalid flag exits before spawn; `--tier` slices overridden ladder.

## Documentation updates

- `v1/docs/agents.md` — patch `--agent` syntax, repeatability, precedence over `modes.patch.agentOrder`, scope boundary (implementation ladder only; review/shrink sub-roles stay config-resolved).

## Acceptance criteria

- [ ] `jarvis1 run --agent <name>[:<model>] …` uses the flag sequence as `modes.patch.agentOrder` for that invocation; persisted config is unchanged.
- [ ] Quota, no-progress, and idle-timeout escalation on patch implementation operate on the overridden ladder.
- [ ] `--tier` start selection applies to the overridden `modes.patch.agentOrder` ladder.
- [ ] Patch review panel, review actuator, and shrink resolution ignore `--agent` (including `reviewActuator` fallback to pre-override `modes.patch.agentOrder`).
- [ ] `jarvis1 run` with no `--agent` behaves as before (`run.test.ts` patch-order fixtures stay green).
- [ ] `v1/docs/agents.md` documents patch `--agent` scope and precedence.
