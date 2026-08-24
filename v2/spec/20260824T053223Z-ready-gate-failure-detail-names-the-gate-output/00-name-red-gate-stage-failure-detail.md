# Name the red gate in stage failure detail

## Problem

A red ready gate settles a pipeline stage with a composed `failureDetail` that names only `ready_gate_failed`; the resolved command and useful output remain outside the terminal record consumed by stage settlement.

## Surface

Primary: terminal ready-gate evidence and daemon operator-error composition. In scope: every execution path that emits a terminal `ready_gate_failed` `loop_finished` record, `RunOperatorError`, and pipeline stage settlement verification. Out of scope: ready-gate classification, repair, resume admission, and `ready_gate_out_of_scope` semantics.

## Decision ledger

- Terminal `ready_gate_failed` `loop_finished` records carry optional `readyGateCommand` and `readyGateOutput` sourced from the final `ReadyGateError` — rules out re-reading gate stdio during daemon settlement.
- `readyGateOutput` is the last 4096 characters of trimmed combined gate output — rules out persisting the ready gate's 16 MiB capture or a prefix that drops the terminal diagnostic.
- Every terminal emitter that can settle `ready_gate_failed`, including direct write, workflow finalization, intent-finalization resume, and review-mutation resume, uses one evidence builder — rules out detail appearing only on one workflow route.
- `composeRunOperatorError` adds `message` for `ready_gate_failed` when terminal command evidence exists; the message names the command and includes the bounded output when present — rules out a second log lookup by `pipeline-stage-dispatch` or presentation-specific reconstruction.
- Legacy `ready_gate_failed` records without command evidence retain the existing reason/action/retryability object without a synthesized placeholder message — rules out misleading detail after upgrades.
- `ready_gate_out_of_scope` retains its existing outside-path fields, resumability, and composed shape — rules out coupling this diagnostic addition to resume admission.

## Task checklist

- Add optional ready-gate command/output fields to `LoopFinishedEvent` and a shared builder that accepts only a matching `ReadyGateError`, trims output, and retains its 4096-character tail.
- Apply the builder to every `ready_gate_failed` terminal record emitted by `write-loop.ts` and `workflow-runner.ts`, without changing other failure kinds.
- Add optional `RunOperatorError.message` and compose it from terminal ready-gate fields for `ready_gate_failed`; leave legacy and `ready_gate_out_of_scope` mappings unchanged.
- Add a pipeline settlement regression that drives a configured-command red gate through terminal logging and entry-run settlement, then reads the persisted stage `failureDetail`.
- Add focused producer/composer regressions for oversized output, every terminal-emitter route, legacy records, and unchanged `ready_gate_out_of_scope` detail.
- Update the durable documentation listed below.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `red ready gate settlement names the gate command and bounded output` drives a configured ready command that fails with `Script not found "ready"`, settles the linked pipeline stage, and asserts `failureDetail.message` contains both the resolved command and that output; it fails against the pre-fix reason-only detail.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `red ready gate settlement names the gate command and bounded output`; Keystone checkpoint: the test contains a `// @mutate` directive that reverts the `ready_gate_failed` message projection in `run-operator-error.ts` to its reason/action/retryability-only baseline and turns red when applied.
- [ ] `v2/src/execution/write-loop.test.ts` test `ready gate terminal evidence truncates oversized output to its tail` asserts a terminal `ready_gate_failed` record names the command, retains the last 4096 output characters, excludes the discarded prefix, and never persists the full oversized transcript; it fails against the pre-fix record with no gate evidence.
- [ ] `v2/src/execution/write-loop.test.ts` — `ready gate terminal evidence truncates oversized output to its tail`; Mutation checkpoint: every added eligibility or truncation guard in the shared evidence builder has a linked `// @mutate` directive in the test, and each mutation turns the test red without a production inversion hook.
- [ ] Focused `write-loop.test.ts` and `workflow-runner.test.ts` regressions assert direct write, workflow completion, intent-finalization resume, and review-mutation resume terminal `ready_gate_failed` records all carry the same bounded command/output fields.
- [ ] `v2/src/daemon/run-operator-error.test.ts` proves a legacy `ready_gate_failed` record without command evidence keeps its existing composed shape and a `ready_gate_out_of_scope` record keeps its existing outside-path fields and resumability without `message`.
- [ ] `v2/src/daemon/run-operator-error.test.ts` — `composeRunOperatorError omits ready gate message without command evidence`; Mutation checkpoint: the legacy-evidence guard has a linked `// @mutate` directive and the test turns red when the guard is inverted without a production inversion hook.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` match the shipped terminal evidence, composed message, and stage-triage behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/write-behavior.md` — terminal `ready_gate_failed` records retain the resolved command and the last 4096 characters of trimmed combined output across every finalization route.
- `v2/docs/daemon-host.md` — `ready_gate_failed` list/wait errors and pipeline stage `failureDetail` gain optional `message` from terminal gate evidence; legacy rows remain detail-free and `ready_gate_out_of_scope` stays unchanged.
- `v2/docs/operator-runbook.md` — read a red stage's `failureDetail.message` first for the gate command and bounded output before opening the full run log.
- `v2/docs/v1-behaviors.md` — record the additive v2 red-gate terminal evidence and stage-settlement message.
