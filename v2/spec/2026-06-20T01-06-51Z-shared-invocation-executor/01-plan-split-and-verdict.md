# 01 - Plan fan-out and verdict-actuator route through executor

## Problem

`intent-split.ts` (fan-out to ready-intents) and `verdict-actuator.ts` (plan review verdict application) carry their own copies of the same inline agent-order fallback loop migrated in 00. They differ only in post-success handling (split writes multiple intent files; actuator applies a verdict and throws on error). They must route through the shared executor and v1 binding from 00.

## Decisions

- Reuse the 00 binding + `executeWithQuotaFallback`; only path-specific post-success and terminal-error handling stays inline. Rules out a separate fallback loop for the structured paths.
- Pure internal refactor: operator stderr, telemetry, and thrown/returned outcomes are unchanged.

## Task checklist

- Migrate `intent-split.ts` and `verdict-actuator.ts` to the shared executor + v1 binding; delete their inline loops.
- Preserve fan-out file output, verdict application, success/error/exhaustion behavior, stderr lines, and telemetry.

## Acceptance criteria

- [ ] Quota exhaustion across all plan agents during intent fan-out and during verdict-actuator falls through agent-by-agent and ends in the existing exhausted outcome (throw / return) unchanged.
- [ ] Strict and lenient quota stderr lines for both paths are byte-identical to current output under `strict` and `lenient`.
- [ ] On agent success, fan-out still writes the same ready-intent files and verdict-actuator still applies the verdict and emits its completion line.
- [ ] `model_config` and terminal `error` stop the chain with the same thrown error as today.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

Internal routing refactor only; operator-facing semantics unchanged. No doc update required (architecture note consolidated in 00 and 04).
