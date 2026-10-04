# 00 - Unconditional terminal `iteration_timeout` operator error and recovery

## Problem

`composeRunOperatorError`, `resolveFailedBlockedAttemptPrecedence`, and `RUN_OPERATOR_ERROR_RECOVERY` still gate terminal `iteration_timeout` on `loop_finished.resumable` and inventory-shaped rows (`inventoryError`, empty subspec lists), so `list`/`wait`/`resume` admission can show `nextAction: stop` and recovery copy still branches to workflow re-dispatch when the write loop already settles terminal stalls with unconditional `resumable: true`.

## Decisions

- Terminal `loop_finished` with `loopOutcomeKind: "iteration_timeout"` always maps to `retryable: true` and `nextAction: "resume"` in `composeRunOperatorError` and `resolveFailedBlockedAttemptPrecedence`; rules out honoring `event.resumable: false` or treating empty `completedSubspecPaths` as non-resumable.
- `completedSubspecPaths`, `remainingSubspecPaths`, `inventoryError`, and `publicationFailure` remain on the projected `error` object when present on the terminal row; rules out dropping diagnostic fields while changing resume admission.
- `RUN_OPERATOR_ERROR_RECOVERY.iteration_timeout` directs `jarvis run resume` on the retained workspace for terminal wall/ceiling stall without a `nextAction` branch to re-dispatch; rules out copy that implies inventory or `resumable: false` on the log row blocks resume.
- `idle_output_timeout` and other outcomes keep existing `loop_finished.resumable` gating; rules out broadening this subspec beyond `iteration_timeout`.

## Task checklist

- [ ] Map terminal `iteration_timeout` to unconditional resume in `composeRunOperatorError` and `resolveFailedBlockedAttemptPrecedence`.
- [ ] Align `RUN_OPERATOR_ERROR_RECOVERY.iteration_timeout` and any `terminalResumeRefusalMessage` paths that special-case `iteration_timeout`.
- [ ] Update `src/daemon/run-operator-error.test.ts` and any admission tests that pin the old stop/stop-copy behavior.

## Acceptance criteria

- [x] `run-operator-error.test.ts` `composeRunOperatorError maps iteration_timeout as a failed terminal` expects `nextAction: "resume"` and `retryable: true` when `loop_finished` omits `resumable`; it fails against the pre-fix code (`stop` today).
- [x] `run-operator-error.test.ts` `composeRunOperatorError projects iteration_timeout inventoryError` keeps `inventoryError` on the projected error but expects `nextAction: "resume"` and `retryable: true`; it fails against the pre-fix code (`stop` today).
- [x] `daemon-wait-run-completion.test.ts` `list and wait project non-resumable iteration_timeout as stop` is removed or rewritten to expect resume projection for terminal `iteration_timeout` even when `loop_finished.resumable` is `false`; the rewritten assertion fails against the pre-fix code.
- [x] `RUN_OPERATOR_ERROR_RECOVERY.iteration_timeout` no longer contains a re-dispatch-first branch for terminal stall (inventory and legacy `resumable: false` on the log row do not change the string contract).
- [x] `bun run typecheck` passes.
- [x] `bun run test:agent` passes for touched `src/daemon/**` surfaces.

## Documentation updates

- Deferred to [02](./02-docs-iteration-timeout-operator-projection.md).
