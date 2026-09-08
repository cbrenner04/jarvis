# 03 - Missing-command source evidence

## Problem

Terminal `ready_gate_command_missing` evidence records the normalized gate command string but not whether that command came from a configured project override or the built-in default. When a configured `readyCommand` equals `bun run ready`, operators cannot tell misconfiguration from an intentional default from command text alone.

## Decision ledger

- Missing-command `loop_finished` evidence carries an explicit configured-versus-default source alongside the normalized command; rules out inferring source from command text when a configured value equals the default.
- Source is derived from whether the gate-owning step carried a stamped `readyCommand` at dispatch/continuation reconstruction time, not from post-hoc string comparison to `DEFAULT_READY_COMMAND`; rules out mislabeling when normalization changes display text.
- Only `ready_gate_command_missing` rows gain the new field; other terminal kinds stay unchanged; rules out widening log-schema churn.

## Task checklist

- Extend ready-gate failure settlement to retain command source on `ReadyGateError` and project it through `readyGateFailureLogFields` into `loop_finished`.
- Update the log event type in `log-stream.ts` with the new optional field.
- Extend the existing missing-command settlement regression to assert both the normalized command and its source.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `settles ready_gate_command_missing without autofix or repair when the gate command is absent` proves terminal `loop_finished` evidence identifies the normalized command and whether its source is configured or default; the test fails against the pre-fix evidence shape reachable on main.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to [[04-documentation]].
