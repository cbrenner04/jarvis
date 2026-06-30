# Intent `jarvis1 intent` override

## Problem

Intent-split runs read `modes.plan.agentOrder` from config. Seed-to-intent experiments require config churn to try a different actuator ladder.

## Decisions

- Reuse `parseAgentFlagValues` and the same `<name>[:<model>]` grammar as `jarvis1 plan` — rules out intent-only flag semantics.
- Parse repeatable `--agent` in `parseIntentArgs`; store raw values on `IntentInvocation` until `loadConfig` — rules out parsing after config load with no fallback order.
- After `loadConfig`, parse/validate `--agent` and shallow-clone config to substitute `modes.plan.agentOrder` before `enterMode` and before worktree/branch/PR or external staging setup — same ordering as plan; rules out substitution only before `runIntentSplitTurn` (bad flags would pass seed checks and create `intent/<name>` artifacts).
- Do not write config — rules out persistence and rules out touching `modes.patch.agentOrder`.
- Override applies only to intent-split actuation (the sole agent-spawning phase in intent mode) — rules out new intent pipeline phases or plan/review coupling.
- Supersedes `02-plan-agent-override.md` exclusion of `--agent` on `jarvis1 intent` for intent-split only; `jarvis1 prompt` remains out of scope — rules out treating the prior plan-spec boundary as still authoritative.
- Missing `--agent` value exits in `parseIntentArgs` with `intent:` prefix — plan parity; rules out attributing missing values to `prefixAgentFlagError`.
- Invalid `--agent` values exit via `prefixAgentFlagError("intent", …)` before spawn — rules out reusing the `plan:` prefix.
- Absent `--agent`, intent behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `INTENT_USAGE`, `parseIntentArgs`, and `IntentInvocation`.
- After `loadConfig`, when override ladder is present, parse/validate and substitute `modes.plan.agentOrder` before `enterMode` (both commit and no-commit paths).
- Extend `prefixAgentFlagError` for `intent`; missing `--agent` value errors in `parseIntentArgs`.
- Update top-level CLI help for `intent`.
- Tests: overridden order drives intent-split binding selection; quota/`model_config` cascade uses override; missing/invalid `--agent` exit before spawn/worktree setup; config file unchanged; no-flag behavior preserved.
- Update docs listed below.

## Documentation updates

- `v1/docs/agents.md` — remove/replace line denying `--agent` on intent; add intent scope boundary (intent-split only; `prompt` excluded); add intent example beside run/plan.
- `v1/docs/config.md` — extend per-run `--agent` bullet to include `jarvis1 intent`.
- `v1/docs/operator-runbook.md` — extend one-run actuator-probe guidance to include `jarvis1 intent`.
- `v2/docs/v1-behaviors.md` — revise intent flag inventory (~L165) to list `--agent`; revise L173 ("reuses the plan agent order") to config-default ladder with per-invocation `--agent` override for intent-split.

## Acceptance criteria

- [ ] `jarvis1 intent --agent <name>[:<model>] …` uses the flag sequence as `modes.plan.agentOrder` for that invocation's intent-split step; persisted config is unchanged.
- [ ] Intent-split quota and `model_config` cascades advance through the overridden ladder.
- [ ] `intent-command.sandbox-unrunnable.test.ts` stays green (no `--agent` behavior unchanged).
- [ ] `jarvis1 intent --agent` with no following value exits `1` before agent spawn or worktree setup with an `intent:`-prefixed error from `parseIntentArgs`.
- [ ] Invalid `--agent` value exits `1` before agent spawn or worktree setup with an `intent:`-prefixed error from `prefixAgentFlagError`.
- [ ] `v1/docs/agents.md` documents `--agent` on `jarvis1 intent` per Documentation updates (including removal of the prior denial).
- [ ] `v1/docs/config.md` and `v1/docs/operator-runbook.md` include `jarvis1 intent` in per-run `--agent` coverage per Documentation updates.
- [ ] `v2/docs/v1-behaviors.md` revises the intent flag inventory and L173 per Documentation updates (not append-only).
