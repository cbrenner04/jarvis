# 01 - Plan fan-out and verdict-actuator route through executor

## Problem

`intent-split.ts` (fan-out to ready-intents) and `verdict-actuator.ts` (plan review verdict application) carry their own copies of the same inline agent-order fallback loop migrated in 00. They differ only in post-success handling (split writes multiple intent files; actuator applies a verdict and throws on error). They must route through the shared executor and v1 binding from 00.

## Decisions

- Reuse the 00 binding + `executeWithQuotaFallback`; only path-specific post-success and terminal-error handling stays inline. Rules out a separate fallback loop for the structured paths.
- intent-split supplies its `intent:` emitter, its no-op telemetry sink, and its `resetIntentStageDir` per-rotation pre-spawn hook through the 00 factory (the hook runs inside `invoke` before each spawn). Rules out running the stage-dir reset once outside the loop and regressing fan-out.
- intent-split reproduces its empty-`agentOrder` `model_config` message (`intent: modes.plan.agentOrder is empty`) from the executor's `final: null` per the 00 caller-mapping rule.
- Pure internal refactor: operator stderr, telemetry, and thrown/returned outcomes are unchanged.

## Task checklist

- Migrate `intent-split.ts` and `verdict-actuator.ts` to the shared executor + v1 binding; delete their inline loops.
- Preserve fan-out file output, verdict application, success/error/exhaustion behavior, stderr lines, and telemetry.

## Acceptance criteria

- [x] Quota exhaustion across all plan agents during intent fan-out and during verdict-actuator falls through agent-by-agent and ends in the existing exhausted outcome (throw / return) unchanged.
- [x] Strict and lenient quota stderr lines for both paths are byte-identical to current output under `strict` and `lenient`.
- [x] On agent success, fan-out still writes the same ready-intent files (with the stage dir reset before every rotation, not once) and verdict-actuator still applies the verdict and emits its completion line.
- [x] Empty `modes.plan.agentOrder` during fan-out still yields the existing `intent: modes.plan.agentOrder is empty` model_config outcome.
- [x] `model_config` and terminal `error` stop the chain with the same thrown error as today.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

Internal routing refactor only; operator-facing semantics unchanged. No doc update required (architecture note consolidated in 00 and 04).
