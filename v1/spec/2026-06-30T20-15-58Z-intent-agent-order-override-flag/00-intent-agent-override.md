# Intent `jarvis1 intent` override

## Problem

Intent-split runs read `modes.plan.agentOrder` from config. Seed-to-intent experiments require config churn to try a different actuator ladder.

## Decisions

- Reuse `parseAgentFlagValues` and the same `<name>[:<model>]` grammar as `jarvis1 plan` — rules out intent-only flag semantics.
- Parse repeatable `--agent` in `parseIntentArgs`; store raw values on `IntentInvocation` until `loadConfig` — rules out parsing after config load with no fallback order.
- When any `--agent` is present, shallow-clone config and substitute `modes.plan.agentOrder` before `runIntentSplitTurn`; do not write config — rules out persistence and rules out touching `modes.patch.agentOrder`.
- Override applies only to intent-split actuation (the sole agent-spawning phase in intent mode) — rules out new intent pipeline phases or plan/review coupling.
- Extend `prefixAgentFlagError` to accept `intent` so invalid flags exit `1` with `intent:` before spawn — rules out reusing the `plan:` prefix.
- Absent `--agent`, intent behavior is unchanged — rules out making the flag required.

## Task checklist

- Add `--agent` to `INTENT_USAGE`, `parseIntentArgs`, and `IntentInvocation`.
- After `loadConfig`, when override ladder is present, substitute `modes.plan.agentOrder` before both commit and no-commit `runIntentSplitTurn` paths.
- Extend `prefixAgentFlagError` for `intent`.
- Update top-level CLI help for `intent`.
- Tests: overridden order drives intent-split binding selection; quota/`model_config` cascade uses override; invalid/missing `--agent` value exits before spawn; config file unchanged; no-flag behavior preserved.
- Update docs listed below.

## Documentation updates

- `v1/docs/agents.md` — add `jarvis1 intent` to per-run `--agent` coverage; scope boundary (intent-split only).
- `v2/docs/v1-behaviors.md` — intent flag inventory and per-invocation `--agent` override for intent-split.

## Acceptance criteria

- [ ] `jarvis1 intent --agent <name>[:<model>] …` uses the flag sequence as `modes.plan.agentOrder` for that invocation's intent-split step; persisted config is unchanged.
- [ ] Intent-split quota and `model_config` cascades advance through the overridden ladder.
- [ ] `jarvis1 intent` with no `--agent` behaves as before.
- [ ] Invalid or missing `--agent` value exits `1` before agent spawn with an `intent:`-prefixed error.
- [ ] `v1/docs/agents.md` documents `--agent` on `jarvis1 intent` per Documentation updates.
- [ ] `v2/docs/v1-behaviors.md` records per-invocation `--agent` override for intent-split and lists `--agent` on `jarvis1 intent`.
