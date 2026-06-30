# Plan `jarvis1 plan` override

## Problem

Plan actuator experiments require editing `modes.plan.agentOrder` in config, running, then reverting. Operators need a one-run plan ladder without mutating persisted order.

## Decisions

- `jarvis1 plan` accepts repeatable `--agent` via the shared parser from `00` — rules out plan-only flag syntax.
- CLI ladder is stored separately from any test-seam `agents` registry (same naming as `01`: `agentOrderOverride`) — rules out overloading `agents` for the CLI ladder.
- When any `--agent` is present, replace `modes.plan.agentOrder` in the in-memory config for that invocation only; do not write config — rules out persistence and rules out touching `modes.patch.agentOrder`.
- Overridden order feeds every wired plan actuator phase that reads `modes.plan.agentOrder`: draft, intent-draft, verdict-actuator, plan PR narrative agent (`prNarrative: agent`), and actuator-side quota/`model_config` cascades on that ladder — rules out partial application to a subset of actuator phases.
- Deferred to first consumer: `name-only` phase — not wired from plan `run.ts` today; pin when a caller exists.
- Plan review adversary/advocate/adjudicator and review-panel quota rotation resolve from a pre-override config snapshot (`modes.review.agentOrder ?? modes.plan.agentOrder` before substitution), threaded into `runPlanReviewPhase` / `runReview` so panel code never reads post-override `modes.plan.agentOrder` — rules out review-panel per-run overrides and rules out passing bare substituted `config` into review.
- `jarvis1 plan --resume` with `--agent`: verdict-actuator uses substituted `modes.plan.agentOrder`; review panel stays on pre-override snapshot — intentional partial override, no extra operator notice — rules out resume silently applying override to the review panel.
- `jarvis1 intent` and `jarvis1 prompt` do not accept `--agent` in this spec — rules out assuming parity with `run` / `plan`.
- Absent `--agent`, plan behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `PLAN_USAGE`, `plan-args.ts`, and `PlanInvocation` as `agentOrderOverride`.
- After `loadConfig`, when override ladder is present, shallow-clone config and substitute `modes.plan.agentOrder` before any plan phase runs; retain pre-override snapshot for review.
- Verify draft, intent-draft, verdict-actuator, PR narrative agent, and actuator quota/`model_config` bindings read the substituted order.
- Thread pre-override review order into plan review so `resolveReviewAgentOrder` never observes substituted `modes.plan.agentOrder`.
- Tests: overridden order drives draft-phase binding selection; review phase and review-panel quota ignore override; `--resume` + `--agent` partial override; config file unchanged; invalid flag exits before spawn.
- Update docs listed below.

## Documentation updates

- `v1/docs/agents.md` — plan `--agent` syntax, repeatability, precedence over `modes.plan.agentOrder`, scope boundary (plan actuators only; review panel stays config-resolved; `intent` / `prompt` out of scope).
- `v1/docs/config.md` — per-run `--agent` does not mutate persisted `agentOrder`.
- `v1/docs/plan-mode.md` — split-ladder semantics under `--agent`: actuators use override; review panel uses pre-override `modes.review.agentOrder ?? modes.plan.agentOrder`.
- `v1/docs/run-loop.md` — cross-link per-run `--agent` override on `jarvis1 run` (does not contradict `agents.md`).
- `v1/docs/operator-runbook.md` — experimentation section: use `--agent` instead of config surgery for one-off patch/plan actuator tests.
- `v2/docs/v1-behaviors.md` — per-invocation `--agent` override for patch and plan; add `--agent` to `run` and `plan` CLI flag inventory.

## Acceptance criteria

- [ ] `jarvis1 plan --agent <name>[:<model>] …` uses the flag sequence as `modes.plan.agentOrder` for that invocation; persisted config is unchanged.
- [ ] Plan draft, intent-draft, verdict-actuator, and plan PR narrative agent phases use the overridden plan ladder.
- [ ] Actuator quota and `model_config` cascades on substituted `modes.plan.agentOrder` (draft, intent-draft, verdict-actuator, PR narrative) advance through the overridden ladder.
- [ ] Plan review adversary/advocate/adjudicator resolution and review-panel quota rotation ignore `--agent` and use the pre-override `modes.review.agentOrder ?? modes.plan.agentOrder` snapshot (panel never reads post-override `modes.plan.agentOrder`).
- [ ] `jarvis1 plan --resume` with `--agent` applies override to verdict-actuator only; review panel stays on pre-override snapshot.
- [ ] `jarvis1 plan` with no `--agent` behaves as before.
- [ ] `v1/docs/agents.md`, `v1/docs/config.md`, `v1/docs/plan-mode.md`, `v1/docs/run-loop.md`, and `v1/docs/operator-runbook.md` document `--agent` per Documentation updates.
- [ ] `v2/docs/v1-behaviors.md` records per-invocation `--agent` override for patch and plan modes and lists `--agent` on `run` and `plan`.
