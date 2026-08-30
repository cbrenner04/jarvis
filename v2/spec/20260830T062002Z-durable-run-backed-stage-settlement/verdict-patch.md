1. Missing-spec failure must take precedence over missing PR evidence when both are absent. Add regression coverage for the combined condition; the spec unconditionally requires the existing missing-spec message for completed entry runs without `specPath`.

2. Settlement tests must prove workflow rollup uses persisted sibling step rows, including a multi-step case where the entry row’s status alone would yield the wrong settlement. This is an explicit acceptance criterion.

3. Failed settlement must preserve established durable-only operator-error semantics. Evidence such as quota failure must produce its specific classification and recovery action (for example, `quota_exhausted` / `retry_later`), while retaining relevant durable details. The documented contract promises the composed operator error, not a generic `harness_failure`.

4. `settleLinkedStagesFromEntryRun` must be a required `StateStore` capability. The store contract guarantees this operation; optional typing and non-null assertions incorrectly allow conforming stores to omit it.
