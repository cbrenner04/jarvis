---
name: invocation-error-names-bindings-not-echoed-prompt
---

# The settled invocation error names the attempted bindings, not an echoed prompt

## Problem

The composed operator error for an `invocation_error` settle pastes the binding's bounded stderr tail. When that tail is the dispatched prompt echoed back — observed as the tail of the plan draft prompt, ending mid-sentence in its `## File output` section — the operator's only diagnosis is a copy of their own input, with nothing naming which binding failed or how.

## Decisions

- When the captured stderr tail cannot be distinguished from the dispatched prompt, the operator error names the failure class and the attempted binding instead of pasting the tail; rules out presenting input as the diagnosis.
- The raw stderr tail stays retrievable from `jarvis run log` for the same run; rules out suppressing evidence rather than relocating it.
- The settled error accounts for every binding in the chain — which rungs were attempted and how each ended; rules out an unattributed failure across a three-entry agent list.
- An ordinary role failure with real stderr keeps reporting that stderr verbatim; rules out a broad rewrite of the normal failure path.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Review-role timeouts and stalls: what `invocation_error` names.
- `v2/docs/daemon-host.md` — binding-failure attribution on the composed operator error.
- `v2/docs/v1-behaviors.md` — operator-error text for echoed-prompt stderr tails.

## Prerequisites

- A binding whose invocation fails before producing a result writes a telemetry row naming its agent, model and binding id with a failure `exit_kind`.
- Every attempted binding in a chain is individually recorded, so per-rung attribution is available to the error composer.
- The dispatched prompt text is available at error-composition time for comparison against the captured stderr tail.
