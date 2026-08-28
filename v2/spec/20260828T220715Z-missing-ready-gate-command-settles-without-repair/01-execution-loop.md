# Execution loop

## Problem

A ready gate whose configured command does not exist is classified as repairable `ready_gate_failed`: the write loop runs project autofix and bounded repair before settling, leaving a dirty worktree and wasted agent time.

## Surface

Execution loop: ready-gate failure classification, `publishWithReadyRepair`, terminal settlement, and operator-error composition. In scope: every route that classifies a gate failure and may enter autofix or bounded repair. Out of scope: changing `ready_gate_out_of_scope` attribution, resume admission for other gate kinds, or gate timeout semantics.

## Decision ledger

- Add `ready_gate_command_missing` to `ReadyGateFailureKind`, `WriteLoopOutcomeKind`, and `RunOperatorErrorReason` — rules out reusing `ready_gate_failed`, which advertises bounded repair, or `ready_gate_out_of_scope`, which is path-attribution semantics.
- Classify only when trimmed combined gate output or spawn-error detail matches (case-insensitive) `Script not found`, `command not found`, or `ENOENT` — rules out exit-code-only matching, which ordinary red suites share.
- `publishWithReadyRepair` short-circuits immediately after `classifyReadyGatePublishFailure` when the classified kind is `ready_gate_command_missing`, before repair-fence freeze, autofix, and `runReadyGateRepairLoop` — rules out a fence-only stop that still burns autofix and one repair iteration.
- Terminal settlement is `failed`, `resumable: false`, `nextAction: fix_config`, with `RUN_OPERATOR_ERROR_RECOVERY` copy that tells the operator to fix the configured gate command and re-dispatch — rules out `resume`, which cannot create a missing command.
- Terminal `loop_finished` rows and composed operator `message` name the resolved gate command from `ReadyGateError.command` and include bounded gate output when present — rules out a reason-only settlement that hides which command is absent.
- Ordinary red gates whose output lacks missing-command signals stay `ready_gate_failed` and keep today's autofix-then-bounded-repair path — rules out widening heuristics to swallow in-scope test or lint failures.

## Task checklist

- Add missing-command detection in ready-gate classification and thread `ready_gate_command_missing` through `classifyReadyGatePublishFailure`, `publishWithReadyRepair`, `readyFailed`, workflow publication settlement, and `composeRunOperatorError`.
- Extend terminal gate-evidence projection so `ready_gate_command_missing` rows carry `readyGateCommand` and optional `readyGateOutput` like `ready_gate_failed`.
- Add write-loop, classification, and operator-error regressions; keep existing bounded-repair coverage green.
- Update the durable documentation listed below.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `settles ready_gate_command_missing without autofix or repair when the gate command is absent` drives a gate failure whose output contains `Script not found "ready"`, asserts `result.kind` is `ready_gate_command_missing`, `fixCalls` and repair-agent invocations are zero, and no `ready_gate_repair` or `ready_gate_autofix_discarded` events are emitted; it fails against the pre-fix repair dispatch reachable on main via `publishWithReadyRepair` after a `ReadyGateError` with that output.
- [ ] `v2/src/execution/write-loop.test.ts` — `settles ready_gate_command_missing without autofix or repair when the gate command is absent`; Keystone checkpoint: the test contains a `// @mutate` directive that reverts the missing-command short-circuit in `publishWithReadyRepair` so pre-fix autofix/repair dispatch returns and the test turns red when applied.
- [ ] `v2/src/execution/write-loop.test.ts` — `settles ready_gate_command_missing without autofix or repair when the gate command is absent`; Mutation checkpoint: the test contains a `// @mutate` directive on the missing-command classification guard and turns red when the guard is inverted without a production inversion hook.
- [ ] `v2/src/execution/write-loop.test.ts` test `settles ready_gate_command_missing without autofix or repair when the gate command is absent` asserts the terminal `loop_finished` row and composed operator error `message` both name the resolved gate command (`bun run ready` in the fixture).
- [ ] `write-loop.test.ts` test `returns retryable ready_gate_failed when the gate fails and does not call the flip` stays green (ordinary red gates still enter bounded repair).

## Documentation updates
