---
name: persist-attributed-invocation-failure-evidence
---

# Persist attributed invocation failure evidence

## Prerequisites

- Every entered binding attempt, including one that fails before returning a typed result, is represented with its binding outcome and emits one attributed `invocation_completed` row when telemetry is configured before the invocation chain settles.

## Module-boundary surface

- Execution-loop terminal failure settlement and structured run logging in `v2/src/execution/`

## Problem

Write-loop settlement drops agent/model attribution from binding attempts, stores the final stderr tail as the operator message even when it echoes the dispatched prompt, and does not put that raw tail in the structured run log.

## Behavior

- Terminal binding-chain failure settlement persists every attempted rung's binding, agent, model, and outcome, marks whether its bounded diagnostic is echoed input, and writes the raw bounded diagnostic to the structured run log without changing ordinary real-stderr bytes.

## Decision ledger

- Classify prompt-echo diagnostics where the execution loop has both the dispatched prompt and binding result; rules out copying full prompts into daemon state or reconstructing the comparison later.
- Persist ordered binding attribution on the existing invocation failure detail; rules out a separate attempt inventory that can drift from terminal settlement.
- Put the raw bounded diagnostic in a dedicated structured run-log event; rules out retaining echoed input as the only operator-error message or relying on private session files for `jarvis run log` recovery.
- Preserve real stderr verbatim within the existing bound; rules out sanitizing genuine agent diagnostics while fixing prompt echoes.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` proves terminal failure persists ordered `bindingId`, `agent`, `model`, and `resultKind` for every attempted rung; it fails against the pre-fix binding-id-only detail.
- [ ] `v2/src/execution/write-loop.test.ts` proves a final stderr tail matching the dispatched prompt is marked as echoed input and the raw bounded tail is emitted in a retrievable structured run-log event; it fails against the pre-fix message-only persistence path.
- [ ] `v2/src/execution/write-loop.test.ts` proves an ordinary real stderr tail is persisted byte-for-byte within the existing bound and emitted in the same run-log evidence shape.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — attributed binding attempts, prompt-echo classification, and structured invocation-failure log evidence.
- `v2/docs/operator-runbook.md` — `jarvis run log` retrieval of the raw bounded diagnostic when the operator summary suppresses echoed input.
- `v2/docs/v1-behaviors.md` — record the changed v2 failure-detail and structured-log behavior.
