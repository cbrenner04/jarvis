# 00 - CLI workflow admission

## Problem

`stampWorkflowStepsWithMachineConfig` (`v2/src/commands/workflow-step-config-stamp.ts`) resolves a project's `fixCommand` and `readyCommand` overrides only for `behavior: "write"` steps. Its non-write branch returns `review` and `review-debate` steps carrying `roleTimeoutMs` and `idleOutputMs` and nothing else.

Review and review-debate steps can own ready-gate finalization, so they reach dispatch without their own project's gate configuration. `resolveReadyGateCommand` (`v2/src/execution/ready-finalize.ts:48`) then falls back to `bun run ready`. Any project whose gate is not a bun script completes all of its work, opens its PR, and fails at the finalization tail — reported as `ready_gate_command_missing` with `nextAction: fix_config`, pointing the operator at project config that is already correct.

Reported as [#3598](https://github.com/cbrenner04/jarvis/issues/3598); confirmed on run `473417b6-6b82-458b-9fb7-616d8d99f565`, which settled with `iterationsConsumed: 0` and `readyGateCommand: "bun run ready"` — a gate-only tail on a non-write row, after every subspec write pass had succeeded.

## Decisions

- Resolve gate commands from each step's own project across write, review, and review-debate behaviors, at the single existing admission stamping seam; rules out behavior-local resolution and rules out a review step borrowing an in-scope write sibling's values (a review step can own a gate with no write sibling in scope).
- Leave absent project overrides unstamped; rules out materializing the built-in `bun run ready` default onto admitted steps, which would erase the configured-versus-default distinction downstream.
- Keep write iteration bounds and review role/idle timeouts behavior-specific; rules out broadening unrelated stamping while sharing gate-command resolution.

## Task checklist

- [ ] Extend the `review` and `review-debate` workflow-step contracts to carry optional `fixCommand` and `readyCommand`.
- [ ] Resolve each step's project once in `stampWorkflowStepsWithMachineConfig` and stamp present gate-command overrides on write, review, and review-debate steps, retaining existing behavior-specific timeout stamping.
- [ ] Add regression coverage for configured and absent review-step overrides; retain existing write-step coverage.
- [ ] Preserve CLI/pipeline shared-preparation parity and pipeline-dispatch write-step coverage.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` proves a `review` step and a `review-debate` step for a project configured with `fixCommand` and `readyCommand` each carry those values; the test fails against the pre-fix write-only branch.
- [ ] `v2/src/commands/workflow.test.ts` proves a `review` step for a project with no overrides carries neither field (absent, not defaulted to `bun run ready`); the test fails if absent overrides are materialized.
- [ ] Existing write-step gate-command stamping tests in `v2/src/commands/workflow.test.ts` stay green.
- [ ] Existing write-step gate-command stamping coverage in `v2/src/daemon/pipeline-stage-dispatch.test.ts` stays green.
- [ ] Existing shared CLI/pipeline preparation parity coverage in `v2/src/daemon/pipeline-workflow-preparation-parity.test.ts` stays green.
- [ ] `v2/docs/install-and-config.md` states that per-project `readyCommand` and `fixCommand` are resolved at admission for every workflow step that can own ready-gate finalization, and that absent overrides are left unstamped.
- [ ] `v2/docs/v1-behaviors.md` records per-project gate-command admission stamping across write, review, and review-debate steps.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/install-and-config.md` — replace the write-only gate-command admission prose with the gate-running workflow-step contract.
- `v2/docs/v1-behaviors.md` — record the v2 behavior change for gate-command admission stamping.
