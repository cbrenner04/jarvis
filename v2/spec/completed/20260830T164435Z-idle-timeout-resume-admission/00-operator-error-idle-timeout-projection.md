# Operator-error idle-timeout projection

## Problem

`composeRunOperatorError` maps every failed `idle_output_timeout` to `retryable: false` and `nextAction: "stop"` regardless of terminal `loop_finished.resumable`. After [idle-timeout-checkpoint-resumability](../completed/20260830T154653Z-idle-timeout-checkpoint-resumability/00-derive-idle-timeout-resumability.md), the write loop can record `resumable: true` when a boundary checkpoint produced a fresh `iteration_commit` `commitSha`, but daemon operator error still advertises stop-only recovery.

## Prerequisites

- [idle-timeout-checkpoint-resumability](../completed/20260830T154653Z-idle-timeout-checkpoint-resumability/00-derive-idle-timeout-resumability.md) merged — terminal `loop_finished` carries conditional `resumable` for `idle_output_timeout`.
- `composeRunOperatorError` maps terminal `loop_finished` records to operator errors for `run list` / `run wait`.

## Decision ledger

- Map failed `loopOutcomeKind: "idle_output_timeout"` with `resumable: true` to `reason: "idle_output_timeout"`, `retryable: true`, `nextAction: "resume"` — rules out unconditional stop when the durable terminal row proves a fresh checkpoint commit.
- Map the same outcome with `resumable: false` or without a matching terminal row to `retryable: false`, `nextAction: "stop"` — rules out inferring checkpoint progress from `outcome_kind` alone.
- Include resumable `idle_output_timeout` in `resumableFinalizationLoopFinishedOutranksAttemptDetail` — rules out mappable last-attempt detail overriding a resumable terminal row (same precedence as `iteration_timeout`).
- Keep store-only `mapInvocationFromAttempt` for `idle_output_timeout` at stop — rules out admitting resume without terminal `loop_finished` proof.
- Update `RUN_OPERATOR_ERROR_RECOVERY.idle_output_timeout` to mention `jarvis run resume`, mirroring `iteration_timeout` — rules out re-dispatch-only static copy.
- **Out of scope:** `pipeline-stage-settlement.ts` store-only `failureDetail` for `idle_output_timeout` stays unconditional stop — no `loop_finished.resumable` access on that path; pipeline UX parity is a follow-up intent.

## Tasks

- Extend `mapFromLoopFinished` and `resumableFinalizationLoopFinishedOutranksAttemptDetail` for conditional `idle_output_timeout` resumability.
- Add `run-operator-error.test.ts` coverage: resumable terminal row (a test that fails when the production resumable-idle-timeout guard is manually inverted), non-resumable and attempt-only stop (regression), precedence over mappable last-attempt detail (regression), static recovery copy (regression).
- Preserve existing `composeRunOperatorError maps idle_output_timeout as a failed, non-retryable terminal` shape for `resumable: false` terminals.

## Acceptance criteria

- [x] `v2/src/daemon/run-operator-error.test.ts` asserts terminal `loop_finished` with `loopOutcomeKind: "idle_output_timeout"` and `resumable: true` composes to `reason: "idle_output_timeout"`, `retryable: true`, and `nextAction: "resume"`; fails against the baseline unconditional stop mapping in `mapFromLoopFinished` (`v2/src/daemon/run-operator-error.ts`) reachable via `composeRunOperatorError maps idle_output_timeout as a failed, non-retryable terminal`.
- [x] That committed-progress operator-error test turns red when the production resumable-idle-timeout branch in `mapFromLoopFinished` (`v2/src/daemon/run-operator-error.ts`) is manually collapsed to the unconditional stop mapping, and green on the real code; no production inversion hook.
- [x] `run-operator-error.test.ts` `composeRunOperatorError maps idle_output_timeout as a failed, non-retryable terminal` and `composeRunOperatorError maps idle_output_timeout from attempt detail alone (no matching loop_finished)` stay green (regression guards for `resumable: false` and store-only stop).
- [x] `run-operator-error.test.ts` asserts resumable `idle_output_timeout` outranks mappable last-attempt detail in `composeRunOperatorError` and `resolveFailedBlockedAttemptPrecedence`, mirroring the existing `iteration_timeout` precedence tests; regression guard — stays green and would fail if precedence omitted `idle_output_timeout`.
- [x] `run-operator-error.test.ts` `idle_output_timeout recovery copy directs resume` asserts `RUN_OPERATOR_ERROR_RECOVERY.idle_output_timeout` mentions `jarvis run resume`; fails against current re-dispatch-only `RUN_OPERATOR_ERROR_RECOVERY.idle_output_timeout`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

None — operator-error table rows and resume-admission prose land in sibling subspecs; no speculative doc churn for this internal mapping slice.
