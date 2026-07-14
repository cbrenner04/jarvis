---
name: invocation-output-age-telemetry
---

# Every invocation records how long it had been silent

`InvocationCompletedRecord` has no output-age field, so "we measured nothing" is indistinguishable
from "the agent produced nothing" — the confusion behind two wrong v1 diagnoses
(`zero-output-iteration-is-a-harness-defect`).

## Behavior

- `InvocationCompletedRecord` carries the output-age measurement at settle time (age of the last
  observed chunk), recorded for every exit kind, not just stalls.
- The field is explicitly null when the age could not be measured; a measured zero-output invocation
  is distinguishable from an unmeasured one.
- Telemetry consumers/queries surface it.

## Prerequisites

- shared invocation tracks a last-output timestamp per invocation
- shared invocation emits `invocation_completed` telemetry records per binding attempt

## Documentation updates

- `v2/docs/` telemetry/record-schema home for `invocation_completed` — the new field and its null semantics.
