---
name: ready-gate-command-missing-spawn-classification
---

# Ready gate missing-command classification uses spawn failure, not transcript substring scan

Unsplit rationale: Spawn-signal classification, anchored output fallback, terminal evidence projection (`LoopFinishedEvent` in `log-stream.ts`), and regression tests are one ready-gate finalization contract in `ready-finalize.ts`; persistence adds optional `loop_finished` fields the loop already owns projecting.

## Primary implementation surface

- `v2/src/execution/ready-finalize.ts`

## Problem

`isMissingReadyGateCommandOutput` substring-scans the full `bun run ready` transcript for `script not found`, `command not found`, or `enoent`. Lint findings and test assertion text that mention `ENOENT` misclassify complete work as non-resumable `ready_gate_command_missing` (`fix_config`) instead of resumable `ready_gate_failed`. The persisted `readyGateOutput` tail often omits the trigger text, so operators cannot see why classification fired.

## Decision ledger

- Classify missing gate command from spawn `ENOENT` / missing executable via `AsyncSubprocessError.code` threaded through the default gate runner into classification — rules out anywhere-substring matching over the full gate transcript.
- When the gate process exits non-zero without spawn failure, classify from anchored package-manager or shell failure lines only (for example a line beginning `error: Script not found` or `command not found:`) — rules out matching `ENOENT` embedded in test names or assertion text and covers the usual missing-`ready` script case (exit 1, not spawn `ENOENT`).
- When `ready_gate_command_missing` fires, persist `readyGateCommandMissingEvidence` on the terminal `loop_finished` row: a single string with the spawn `code`/message or the matched anchored line, trimmed and capped at 512 code units — rules out relying on the 4096-character `readyGateOutput` tail alone, which can omit the trigger.
- Gate output whose only `ENOENT`/`command not found` signals live inside failing-test messages settles `ready_gate_failed` — rules out non-resumable `fix_config` for ordinary lint or test failures.

## Acceptance criteria

- [ ] `ready-finalize.test.ts` `"does not classify ENOENT embedded in failing-test output as ready_gate_command_missing"` fails against the pre-fix substring classifier and asserts `ready_gate_failed`.
- [ ] `ready-finalize.test.ts` `"classifies spawn ENOENT and anchored Script not found as ready_gate_command_missing"` fails against the pre-fix classifier; `ready-finalize.test.ts` `"classifies missing-command gate output as ready_gate_command_missing and keeps ordinary red output on ready_gate_failed"` stays green for anchored `Script not found` and `command not found:` cases (updated expectations, not bare `spawn ENOENT` transcript substring).
- [ ] `ready-finalize.test.ts` `"projects readyGateCommandMissingEvidence on ready_gate_command_missing settlement"` fails against the pre-fix row shape and asserts the capped evidence string on `readyGateFailureLogFields` output.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — ready-gate missing-command paragraph: replace the `Script not found` / `command not found` / `ENOENT` anywhere-in-output rule with spawn `ENOENT` plus anchored package-manager/shell failure lines; note `readyGateCommandMissingEvidence`.
- `v2/docs/write-behavior.md` and `v2/docs/install-and-config.md` — align the same classification contract (cross-link `v1-behaviors.md` rather than duplicating prose).
- `v2/docs/operator-runbook.md` — **Missing gate command** paragraph: state required evidence (`readyGateCommandMissingEvidence`, spawn code, or anchored failure line) and that lint findings mentioning `ENOENT` no longer trigger classification.

## Prerequisites

- `ready_gate_command_missing` is a distinct terminal outcome that settles non-resumable with `nextAction: fix_config` and skips autofix and bounded repair.
- Terminal `loop_finished` rows for gate failures already carry optional `readyGateCommand` and `readyGateOutput` projected from `ReadyGateError`.
- `LoopFinishedEvent` in `v2/src/persistence/log-stream.ts` is the durable row type; new optional fields follow the existing `readyGate*` projection pattern.
