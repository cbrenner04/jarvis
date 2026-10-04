# Classify missing gate command from spawn signal and anchored failure lines

## Problem

`isMissingReadyGateCommandOutput` substring-scans the full `bun run ready` transcript for `script not found`, `command not found`, or `enoent`. Lint findings and test assertion text that mention `ENOENT` misclassify complete work as non-resumable `ready_gate_command_missing` (`fix_config`) instead of resumable `ready_gate_failed`. The persisted `readyGateOutput` tail often omits the trigger text, so operators cannot see why classification fired.

## Surface

Ready-gate finalization in `v2/src/execution/ready-finalize.ts`: missing-command classification, default gate runner spawn-error threading, terminal `loop_finished` evidence projection (`readyGateFailureLogFields` and `LoopFinishedEvent` in `v2/src/persistence/log-stream.ts`), and regressions in `ready-finalize.test.ts`. Out of scope: `ready_gate_out_of_scope` attribution, repair-loop semantics, operator-error reason mapping, and resume admission for other gate kinds.

## Decision ledger

- Classify missing gate command from spawn `ENOENT` / missing executable via `AsyncSubprocessError.code` threaded through the default gate runner into classification — rules out anywhere-substring matching over the full gate transcript.
- When the gate process exits non-zero without spawn failure, classify from anchored package-manager or shell failure lines only (for example a line beginning `error: Script not found` or `command not found:`) — rules out matching `ENOENT` embedded in test names or assertion text and covers the usual missing-`ready` script case (exit 1, not spawn `ENOENT`).
- When `ready_gate_command_missing` fires, persist `readyGateCommandMissingEvidence` on the terminal `loop_finished` row: a single string with the spawn `code`/message or the matched anchored line, trimmed and capped at 512 code units — rules out relying on the 4096-character `readyGateOutput` tail alone, which can omit the trigger.
- Gate output whose only `ENOENT`/`command not found` signals live inside failing-test messages settles `ready_gate_failed` — rules out non-resumable `fix_config` for ordinary lint or test failures.

## Task checklist

- Replace `isMissingReadyGateCommandOutput` anywhere-substring scan with spawn-signal classification plus anchored-line fallback; thread spawn `code` from `createDefaultRunReadyGate` through `ReadyGateError` into `classifyReadyGateFailure`.
- Add optional `readyGateCommandMissingEvidence` to `LoopFinishedEvent` and project it from `readyGateFailureLogFields` on `ready_gate_command_missing` settlements.
- Add and update `ready-finalize.test.ts` regressions; keep existing missing-command and ordinary-red classification coverage green with updated spawn/anchor expectations.
- Update the durable documentation listed below.

## Acceptance criteria

- [x] `v2/src/execution/ready-finalize.test.ts` test `does not classify ENOENT embedded in failing-test output as ready_gate_command_missing` fails against the pre-fix substring classifier and asserts `ready_gate_failed`.
- [x] `v2/src/execution/ready-finalize.test.ts` test `classifies spawn ENOENT and anchored Script not found as ready_gate_command_missing` fails against the pre-fix classifier.
- [x] `v2/src/execution/ready-finalize.test.ts` test `classifies missing-command gate output as ready_gate_command_missing and keeps ordinary red output on ready_gate_failed` stays green with updated expectations for anchored `Script not found` and `command not found:` cases only.
- [x] `v2/src/execution/ready-finalize.test.ts` test `projects readyGateCommandMissingEvidence on ready_gate_command_missing settlement` fails against the pre-fix row shape and asserts the capped evidence string on `readyGateFailureLogFields` output.
- [x] `v2/docs/v1-behaviors.md` replaces the `Script not found` / `command not found` / `ENOENT` anywhere-in-output missing-command rule with spawn `ENOENT` plus anchored package-manager/shell failure lines and notes `readyGateCommandMissingEvidence`.
- [x] `v2/docs/write-behavior.md` aligns the ready-finalization missing-command classification contract with the spawn/anchored rule and cross-links `v1-behaviors.md` rather than duplicating prose.
- [x] `v2/docs/install-and-config.md` aligns the missing-`readyCommand` settlement classification contract with the spawn/anchored rule and cross-links `v1-behaviors.md` rather than duplicating prose.
- [x] `v2/docs/operator-runbook.md` **Missing gate command** paragraph states required evidence (`readyGateCommandMissingEvidence`, spawn code, or anchored failure line) and that lint findings mentioning `ENOENT` no longer trigger classification.
- [x] `bun run typecheck` exits zero.
- [x] `bun run test:v2` and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/v1-behaviors.md` — ready-gate missing-command paragraph: replace the `Script not found` / `command not found` / `ENOENT` anywhere-in-output rule with spawn `ENOENT` plus anchored package-manager/shell failure lines; note `readyGateCommandMissingEvidence`.
- `v2/docs/write-behavior.md` and `v2/docs/install-and-config.md` — align the same classification contract (cross-link `v1-behaviors.md` rather than duplicating prose).
- `v2/docs/operator-runbook.md` — **Missing gate command** paragraph: state required evidence (`readyGateCommandMissingEvidence`, spawn code, or anchored failure line) and that lint findings mentioning `ENOENT` no longer trigger classification.
