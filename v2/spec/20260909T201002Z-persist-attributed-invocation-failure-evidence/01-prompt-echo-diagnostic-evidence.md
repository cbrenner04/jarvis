# Prompt-echo classification and structured invocation-failure diagnostic evidence

## Problem

On terminal `invocation_failure` the write loop stores the final binding's stderr tail (last `INVOCATION_FAILURE_MESSAGE_MAX_CODE_UNITS` code units) as `invocationFailureDetail.message`, which `v2/src/daemon/run-operator-error.ts` surfaces verbatim as the operator error message. Some agents echo the dispatched prompt on stderr, so the operator summary shows the harness's own prompt back instead of a diagnostic — and because that tail lives only in the detail message, the raw bytes are then unavailable from `jarvis run log`. Real stderr and echoed input are indistinguishable downstream.

## Behavior

`runStep` classifies the settling binding's stderr as echoed input when it has both the dispatched prompt and the failing result. Terminal invocation-failure settlement marks that classification on the persisted detail, suppresses an echoed tail from the operator `message`, and emits the raw bounded diagnostic as a dedicated structured run-log event on every invocation-failure settlement — echoed or not. An ordinary real stderr tail is persisted byte-for-byte within the existing bound, unchanged.

## Decisions

- Classify in `runStep`, carrying the verdict on the `invocation_failure` `StepRunResult` variant; rules out passing the dispatched prompt into daemon state or reconstructing the comparison at settlement, where the prompt is out of scope.
- Treat a non-empty trimmed stderr that the dispatched prompt contains as echoed input; rules out exact whole-prompt equality, which misses the common truncated-tail echo. Deferred to first consumer: fuzzy/normalized matching — pin when a real agent echoes with reformatting.
- When echoed, omit `message` from the persisted detail rather than storing a redacted placeholder; the existing `mapInvocationFailureDetail` fallback already yields the generic `invocation_error` summary for a message-less detail, and rules out re-teaching every downstream consumer to skip a sentinel.
- Emit the raw bounded diagnostic in a dedicated run-log event on every invocation-failure settlement, not only echoed ones; rules out an evidence shape that differs by classification and forces the operator to know which case they are in before looking.
- Keep the raw diagnostic's existing bound (last `INVOCATION_FAILURE_MESSAGE_MAX_CODE_UNITS` code units) before the log sink's own truncation; rules out widening the retained-byte budget as a side effect of relocating the evidence.
- Leave `v2/src/tui/tui-log-follow-lines.ts` untouched; its formatter switch is non-exhaustive and falls through, so the new event renders without a case and TUI presentation is out of scope.

## Task checklist

- [ ] Add the echoed-input verdict to the `invocation_failure` variant of `StepRunResult` and classify it in `v2/src/execution/step-runner.ts`.
- [ ] Add the invocation-failure diagnostic event to `v2/src/persistence/log-stream.ts`.
- [ ] Mark the detail, suppress an echoed `message`, and append the diagnostic event at settlement in `v2/src/execution/write-loop.ts`.
- [ ] Add the failing-first regression tests in `v2/src/execution/write-loop.test.ts`.
- [ ] Update the docs listed below.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` proves a final stderr tail matching the dispatched prompt is marked as echoed input on the persisted detail, is not carried as the detail `message`, and has its raw bounded tail emitted in a retrievable structured run-log event; it fails against the pre-fix message-only persistence path.
- [ ] `v2/src/execution/write-loop.test.ts` proves an ordinary real stderr tail is persisted byte-for-byte within the existing bound as the detail `message`, is not marked echoed, and is emitted in the same run-log evidence shape; it fails against the pre-fix code, which emits no such event.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — prompt-echo classification and the structured invocation-failure diagnostic event.
- `v2/docs/operator-runbook.md` — `jarvis run log` retrieval of the raw bounded diagnostic when the operator summary suppresses echoed input.
- `v2/docs/v1-behaviors.md` — record the changed v2 operator-message and structured-log behavior.
