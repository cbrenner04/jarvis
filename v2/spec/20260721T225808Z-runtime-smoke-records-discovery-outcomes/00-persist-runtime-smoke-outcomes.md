# Persist runtime-smoke outcomes

Completion discards successful runtime-smoke results, so the durable run log cannot distinguish executed evidence from discovery absence.

## Decisions

- Append a `runtime_smoke_outcome` event for each successful verifier result; rules out encoding success only in the generic terminal `loop_finished` event.
- Model the event as an outcome-discriminated union: `observed-clean`, or `not-runnable` with `inspectedPaths` and non-empty `discoveryReason`; rules out optional evidence fields that permit reasonless discovery absence.
- Keep `smoke-failure` on the existing terminal failure path; rules out broadening this change into duplicate failure records.

## Tasks

- Carry the successful verifier result through ready finalization to the write loop and append it to the run's `LogSink`.
- Add the typed durable-log event and completion-path regression coverage for both successful outcomes.
- Update the durable operator, workflow-runner, and v1-parity documentation.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] A successful `not-runnable` runtime smoke for production changes under `v2/src/**` or `shared/**` appends a durable `runtime_smoke_outcome` record with outcome `not-runnable`, every inspected production path, and a non-empty discovery reason.
- [ ] A successful executed smoke appends a durable `runtime_smoke_outcome` record with outcome `observed-clean`, distinguishable from `not-runnable` by run-log consumers.
- [ ] `v2/src/execution/workflow-runner.test.ts` drives completion through a successful injected `not-runnable` verifier result and asserts the durable event; the test fails against the pre-fix result-discarding path and passes after the change.
- [ ] `v2/docs/operator-runbook.md` Gate trust explains how to inspect runtime-smoke evidence and what `not-runnable` certifies; `v2/docs/workflow-runner.md` defines the durable outcome fields; `v2/docs/v1-behaviors.md` records the changed v2 completion evidence.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust inspection and `not-runnable` meaning.
- `v2/docs/workflow-runner.md` — durable runtime-smoke event contract.
- `v2/docs/v1-behaviors.md` — changed v2 completion evidence.
