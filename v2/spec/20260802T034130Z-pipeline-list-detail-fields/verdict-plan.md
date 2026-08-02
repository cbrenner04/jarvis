- Require `bun run test:integration:v2` alongside typecheck and `test:v2`, matching repository verification rules for `v2/**` changes.
- Define the exact snapshot/wire placement of every new field, especially admission `seedPath`, and specify whether absent values serialize as omitted or `null`.
- Require regression coverage for separate terminal-publication success and failure records, including the mutually exclusive counterpart remaining null.
- Require stage diagnostics to preserve representative falsy non-null JSON values, not merely nullable values.
- Extend the existing CLI exact-output regression to pin the new `jarvis pipeline list` JSON fields and their serialization semantics.
- Anchor preserved derived state, timing, stage order, and one-shot behavior to the relevant existing tests, as required for behavior-preservation criteria.
- Clarify that `seedPath` is projected unchanged from durable admission data and may be relative to the admission `cwd`; adding `cwd` is outside this intent.

The single subspec remains appropriately atomic; no split is required.
