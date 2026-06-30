# Plan `jarvis1 plan` override

## Problem

Plan actuator experiments require editing `modes.plan.agentOrder` in config, running, then reverting. Operators need a one-run plan ladder without mutating persisted order.

## Decisions

- `jarvis1 plan` accepts repeatable `--agent` via the shared parser from `00` — rules out plan-only flag syntax.
- When any `--agent` is present, replace `modes.plan.agentOrder` in the in-memory config for that invocation only; do not write config — rules out persistence and rules out touching `modes.patch.agentOrder`.
- Overridden order feeds every plan actuator phase that reads `modes.plan.agentOrder`: draft, intent-draft, name-only, verdict-actuator, plan PR narrative agent (`prNarrative: agent`), and plan quota/model_config cascades — rules out partial application to a subset of phases.
- Plan review adversary/advocate/adjudicator resolve from the pre-override config snapshot (`modes.review.agentOrder ?? modes.plan.agentOrder` before substitution) — rules out review-panel per-run overrides and rules out `resolveReviewAgentOrder` reading the post-override in-memory `modes.plan.agentOrder`.
- Absent `--agent`, plan behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `PLAN_USAGE`, `plan-args.ts`, and `PlanInvocation`.
- After `loadConfig`, when override ladder is present, shallow-clone config and substitute `modes.plan.agentOrder` before any plan phase runs.
- Verify draft, intent-draft, name-only, verdict-actuator, PR narrative agent, and quota cascade bindings read the substituted order.
- Pass review-panel order from the pre-override config snapshot into plan review (or equivalent) so `resolveReviewAgentOrder` does not observe the substituted `modes.plan.agentOrder`.
- Tests: overridden order drives draft-phase binding selection; review phase ignores override; config file unchanged; invalid flag exits before spawn.
- Update docs listed below.

## Documentation updates

- `v1/docs/agents.md` — plan `--agent` syntax, repeatability, precedence over `modes.plan.agentOrder`, scope boundary (plan actuators only; review panel stays config-resolved).
- `v1/docs/config.md` — per-run `--agent` does not mutate persisted `agentOrder`.
- `v1/docs/operator-runbook.md` — experimentation section: use `--agent` instead of config surgery for one-off patch/plan actuator tests.
- `v2/docs/v1-behaviors.md` — patch and plan modes honor per-invocation `--agent` override.

## Acceptance criteria

- [ ] `jarvis1 plan --agent <name>[:<model>] …` uses the flag sequence as `modes.plan.agentOrder` for that invocation; persisted config is unchanged.
- [ ] Plan draft, intent-draft, name-only, verdict-actuator, and plan PR narrative agent phases use the overridden plan ladder.
- [ ] Plan quota and `model_config` cascades advance through the overridden plan ladder.
- [ ] Plan review adversary/advocate/adjudicator resolution ignores `--agent` and uses the pre-override `modes.review.agentOrder ?? modes.plan.agentOrder` snapshot.
- [ ] `jarvis1 plan` with no `--agent` behaves as before.
- [ ] `v1/docs/agents.md`, `v1/docs/config.md`, and `v1/docs/operator-runbook.md` document `--agent` per Documentation updates.
- [ ] `v2/docs/v1-behaviors.md` records per-invocation `--agent` override for patch and plan modes.
