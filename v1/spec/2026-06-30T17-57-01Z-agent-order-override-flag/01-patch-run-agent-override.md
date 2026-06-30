# Patch `jarvis1 run` override

## Problem

Patch actuator experiments require editing `modes.patch.agentOrder` in config, running, then reverting. Operators need a one-run ladder without mutating persisted order.

## Decisions

- `jarvis1 run` accepts repeatable `--agent` using the shared parser from `00` — rules out run-only flag syntax.
- CLI ladder is stored separately from `RunCommandOptions.agents` (test seam: `Partial<Record<AgentName, Agent>>` fake registry) — e.g. `agentOrderOverride?: AgentEntry[]` on `RunCommandOptions` / `ParsedArgs` — rules out overloading `agents` for the CLI ladder.
- When any `--agent` is present, replace `modes.patch.agentOrder` in the in-memory config for that invocation only; do not write `~/.jarvis/config.json` — rules out config persistence and rules out touching `modes.plan.agentOrder`.
- Quota, no-progress, idle-timeout, and `--tier` slicing operate on the overridden ladder — rules out tier/quota reading the pre-override config order.
- Single-rung override with `--tier hard` (or any tier that slices past the ladder end) follows existing tier validation (empty post-slice ladder exits non-zero) — rules out special-case bypass for one-rung overrides.
- `modes.patch.subRoleAgentOrder` stays config-resolved; `reviewActuator` fallback to `modes.patch.agentOrder` uses the pre-override config snapshot — rules out review/shrink inheriting `--agent` via the default sub-role fallback path.
- `--resume-review` never runs implementation iterations; `--agent` does not supply implementation agents on that path — rules out override ladder driving implementation under resume-review.
- `jarvis1 intent` and `jarvis1 prompt` do not accept `--agent` in this spec — rules out assuming parity with `run` / `plan`.
- Absent `--agent`, patch behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `jarvis1 run` usage, `cli.ts` parse path, and `ParsedArgs`; thread as `agentOrderOverride` (not `agents`).
- After `loadConfig`, when override ladder is present, shallow-clone config and substitute `modes.patch.agentOrder`.
- Confirm `buildActiveAgents`, quota/no-progress/idle escalation, and tier start index use the substituted order.
- Pass review-panel and review-actuator orders from pre-override config (or explicit overrides) so sub-role fallback does not read substituted `modes.patch.agentOrder`.
- Tests: override ladder used for implementation iterations; config file unchanged after run; invalid flag exits before spawn; `--tier` slices overridden ladder; override-negative review/shrink/resume-review cases.

## Documentation updates

- `v1/docs/agents.md` — patch `--agent` syntax, repeatability, precedence over `modes.patch.agentOrder`, scope boundary (implementation ladder only; review/shrink sub-roles stay config-resolved; `intent` / `prompt` out of scope).

## Acceptance criteria

- [x] `jarvis1 run --agent <name>[:<model>] …` uses the flag sequence as `modes.patch.agentOrder` for that invocation; persisted config is unchanged.
- [x] Quota, no-progress, and idle-timeout escalation on patch implementation operate on the overridden ladder.
- [x] `--tier` start selection applies to the overridden `modes.patch.agentOrder` ladder; single-rung override with a tier that slices past the ladder end exits non-zero per existing tier validation.
- [x] With `--agent` set, patch review panel and review actuator resolve from pre-override config / `subRoleAgentOrder`, not the override ladder (override-negative test).
- [x] With `--agent` set, shrink resolution ignores the implementation override ladder (override-negative test).
- [x] `--resume-review` with `--agent` invokes no implementation agents from the override ladder (`run.test.ts` `no implementation agent is invoked under --resume-review` stays green).
- [x] `jarvis1 run` with no `--agent` behaves as before (`config.test.ts` `buildActiveAgents selects all agents from agentOrder with trivial tier` stays green).
- [x] `v1/docs/agents.md` documents patch `--agent` scope and precedence.
