# 02 - Review debate loop routes through executor

## Problem

`v1/src/modes/review/run.ts` `runRoleAttempt` reimplements the agent-order fallback inline (`remainingAgents.shift()` on quota) with its own porcelain guard and `applyQuotaFallbackWhenAllowed` call per role attempt, then maps quota/model_config/error to `ReviewTerminalError` exit codes. This is the third copy of the fallback loop; it must route through the shared executor and 00 binding while preserving review's role/blocker/commit semantics.

## Decisions

- Only the spawn+classification+fallback rotation moves to `executeWithQuotaFallback` + the 00 binding; role orchestration (adversary→advocate→adjudicator), write-boundary enforcement, blocker handling, commit, `onQuotaRotation`/`onAllAgentsQuotaExhausted` hooks, and reserved-exit-code normalization stay in `run.ts`. Rules out absorbing review's role/blocker control flow into the shared loop.
- Terminal mapping unchanged: all-agents-exhausted → exit `2` (`HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED`), `model_config` → `3`, colliding error code → normalized via `RESERVED_REVIEW_EXIT_CODES`. Rules out altering review exit-code contract.

## Acceptance criteria

- [ ] Quota exhaustion across all review agents during any role attempt (adversary, advocate, adjudicator) exits `2` with the existing exhausted message.
- [ ] A single agent's quota result still rotates to the next configured review agent within the same role attempt; non-quota error/model_config stop the chain with exits unchanged (`3` for model_config; reserved error codes normalized to `1`).
- [ ] `onQuotaRotation` and `onAllAgentsQuotaExhausted` callbacks fire with the same arguments as today.
- [ ] Review role/blocker/commit behavior and `patch_phase: "review"` telemetry are unchanged.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

Internal routing refactor only; review exit codes, messages, and telemetry unchanged. No doc update required (architecture note consolidated in 00 and 04).
