---
name: ready-gate-command-missing-spawn-classification
---

# Ready gate missing-command classification uses spawn failure, not transcript substring scan

Unsplit rationale: Spawn-signal classification, anchored output fallback, terminal evidence projection, and regression tests are one ready-gate finalization contract in `ready-finalize.ts`; persistence only adds an optional `loop_finished` field the loop already owns projecting.

## Primary implementation surface

- `v2/src/execution/ready-finalize.ts`

## Problem

`isMissingReadyGateCommandOutput` substring-scans the full `bun run ready` transcript for `script not found`, `command not found`, or `enoent`. Lint findings and test assertion text that mention `ENOENT` misclassify complete work as non-resumable `ready_gate_command_missing` (`fix_config`) instead of resumable `ready_gate_failed`. The persisted `readyGateOutput` tail often omits the trigger text, so operators cannot see why classification fired.

## Decision ledger

- Classify missing gate command from spawn `ENOENT` / missing executable via `AsyncSubprocessError.code` threaded through the default gate runner into classification — rules out anywhere-substring matching over the full gate transcript.
- If output matching is retained as fallback, anchor to the shell or package-manager failure line (for example a line beginning `error: Script not found`) — rules out matching `ENOENT` embedded in test names or assertion text.
- When `ready_gate_command_missing` fires, persist the matched marker and surrounding context on the terminal `loop_finished` row — rules out relying on the 4096-character `readyGateOutput` tail alone, which can omit the trigger.
- Gate output whose only `ENOENT`/`command not found` signals live inside failing-test messages settles `ready_gate_failed` — rules out non-resumable `fix_config` for ordinary lint or test failures.

## Acceptance criteria

- [ ] Gate output containing `ENOENT` only inside test names or assertion text does not classify as `ready_gate_command_missing` — pinned by a test whose gate output embeds `ENOENT` in a failing-test message and asserts `ready_gate_failed`.
- [ ] A genuinely missing gate command still classifies as `ready_gate_command_missing` — pinned by a test driving a spawn failure for a non-existent command.
- [ ] A `ready_gate_command_missing` settlement records the evidence that triggered it (matched marker plus context) on the durable row — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the **Missing gate command** paragraph: state what evidence the classification requires and that lint findings mentioning `ENOENT` no longer trigger it.

## Prerequisites

- `ready_gate_command_missing` is a distinct terminal outcome that settles non-resumable with `nextAction: fix_config` and skips autofix and bounded repair.
- Terminal `loop_finished` rows for gate failures already carry optional `readyGateCommand` and `readyGateOutput` projected from `ReadyGateError`.
