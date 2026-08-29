# Classify missing gate command and skip repair

## Problem

A ready gate whose configured command does not exist is classified as repairable `ready_gate_failed`: the write loop runs project autofix and bounded repair before settling, leaving a dirty worktree and wasted agent time (observed spending ~14 minutes scaffolding an Xcode project / `Makefile` / `package.json` / `scripts/` just to make a `ready` script exist before settling `blocked`).

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
- Add classification, write-loop, and operator-error regressions; keep existing bounded-repair coverage green.
- Update the durable documentation listed below.

## Acceptance criteria

- [x] `v2/src/execution/ready-finalize.test.ts` adds pre-fix-failing coverage that output containing `Script not found`, `command not found`, or `ENOENT` classifies `ready_gate_command_missing`, while ordinary failing test output without those signals stays `ready_gate_failed`.
- [x] `v2/src/daemon/run-operator-error.test.ts` proves `ready_gate_command_missing` maps to `nextAction: fix_config`, `retryable: false`, recovery copy that does not mention `jarvis run resume`, and a `message` naming the gate command.
- [x] `v2/src/execution/write-loop.test.ts` test `settles ready_gate_command_missing without autofix or repair when the gate command is absent` drives a gate failure whose output contains `Script not found "ready"`, asserts `result.kind` is `ready_gate_command_missing`, `fixCalls` and repair-agent invocations are zero, and no `ready_gate_repair` or `ready_gate_autofix_discarded` events are emitted; it fails against the pre-fix repair dispatch reachable on main via `publishWithReadyRepair` after a `ReadyGateError` with that output.
- [x] `v2/src/execution/write-loop.test.ts` — `settles ready_gate_command_missing without autofix or repair when the gate command is absent`; Keystone checkpoint: the test body carries a `// @mutate` directive reverting the missing-command short-circuit in `publishWithReadyRepair` so pre-fix autofix/repair dispatch returns, and the test turns RED when applied.
- [x] `v2/src/execution/write-loop.test.ts` — `settles ready_gate_command_missing without autofix or repair when the gate command is absent`; Mutation checkpoint: the test body carries a `// @mutate` directive on the missing-command classification guard and turns RED when the guard is inverted without a production inversion hook.
- [x] `v2/src/execution/write-loop.test.ts` test `settles ready_gate_command_missing without autofix or repair when the gate command is absent` asserts the terminal `loop_finished` row and composed operator error `message` both name the resolved gate command (`bun run ready` in the fixture).
- [x] `v2/src/execution/write-loop.test.ts` test `returns retryable ready_gate_failed when the gate fails and does not call the flip` stays green (ordinary red gates still enter bounded repair).
- [x] `v2/docs/install-and-config.md`, `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md` match the shipped missing-command settlement, non-resumability, and repair bypass.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/install-and-config.md` — a missing `readyCommand` / default gate script settles `ready_gate_command_missing` with no repair; fix project config and re-dispatch, do not resume.
- `v2/docs/operator-runbook.md` — recovery for `ready_gate_command_missing`: read `error.message` for the absent command, fix config, re-dispatch; resume is refused.
- `v2/docs/write-behavior.md` — ready finalization classifies missing-command gate failures and skips autofix and bounded repair before settlement.
- `v2/docs/v1-behaviors.md` — record that v2 no longer treats a missing gate command as a repairable red gate.
