# Source-aware missing-gate remediation

## Problem

`mapFromLoopFinished` maps every `ready_gate_command_missing` settlement to `nextAction: fix_config` (`v2/src/daemon/run-operator-error.ts:255`), even though finalization already records `readyGateCommandSource` (`configured` vs `default`) on the terminal event (`v2/src/execution/ready-finalize.ts:226`, `v2/src/persistence/log-stream.ts:63`). A default-source miss — the built-in `bun run ready` is unresolvable — sends the operator to edit project config that is already correct.

## Behavior

Missing-gate operator errors carry the executed command and its source. `readyGateCommandSource: "configured"` keeps `nextAction: fix_config`; `"default"` reports `nextAction: stop` as a harness-resolution failure. Absent source (legacy rows) keeps today's `fix_config`.

## Decisions

- Remediation branches on the persisted `readyGateCommandSource` field only; rules out inferring source by comparing the command string to `bun run ready`, which misreads a project that configures that exact command.
- Legacy rows with no recorded source keep `fix_config`; rules out silently downgrading pre-existing missing-gate rows to the non-actionable `stop`.
- The message names the source alongside the command; rules out encoding source only in the closed `nextAction`, which leaves `jarvis run log` readers unable to tell the two misses apart.
- The `RUN_OPERATOR_ERROR_RECOVERY` hint for the reason covers both branches in one string; rules out making that table source-keyed, which would change its `Record<RunOperatorErrorReason, string>` contract for one reason.

## Task checklist

- [ ] Branch the `ready_gate_command_missing` case in `v2/src/daemon/run-operator-error.ts` on `event.readyGateCommandSource`.
- [ ] Include the source in the composed `message`.
- [ ] Update the recovery hint to state the configured-vs-built-in split.
- [ ] Add daemon regressions for both branches.
- [ ] Update the two docs below.

## Acceptance criteria

- [ ] A regression in `v2/src/daemon/run-operator-error.test.ts` proves a configured-source `ready_gate_command_missing` settlement composes an error naming the executed command and the configured source with `nextAction: fix_config`.
- [ ] A sibling regression proves a default-source settlement names `bun run ready` and the built-in source and reports `nextAction: stop`; it fails against the pre-fix unconditional `fix_config` mapping.
- [ ] A missing-gate settlement with no recorded source still composes `nextAction: fix_config` (legacy rows unchanged).
- [ ] `v2/src/daemon/pipeline-execution.test.ts` missing-gate projections stay green (pipeline `failureDetail` shape unchanged by the mapping change).
- [ ] `v2/src/commands/run.test.ts` missing-gate projections stay green (list/wait shape unchanged by the mapping change).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — in **Missing gate command**, document `readyGateCommandSource` and the configured `fix_config` versus built-in `stop` remediation split.
- `v2/docs/v1-behaviors.md` — extend the per-project gate-command-override parity entry with source-aware missing-gate remediation.
