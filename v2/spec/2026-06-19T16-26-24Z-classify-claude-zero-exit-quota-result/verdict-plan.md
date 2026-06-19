- Replace the conflicting `0`-exit rule in `v1/docs/quota-signals.md` and its outcome-matrix row; Claude’s verified error envelope is a quota exception, not `ok`.

- Include the complete reported JSON envelope in the subspec and documentation, including the field containing `"You've hit your monthly spend limit"`; tests need one exact verified input.

- Define the quota-message match used with `is_error: true` and `api_error_status: 429`; the existing Claude patterns do not cover the reported monthly-spend text.

- Require explicit non-quota coverage for each missing predicate: false/missing `is_error`, non-429 status, and a non-quota message. This prevents broad structured-error fallback.

- Specify the diagnostic representation for stdout-delivered envelopes and assert it is preserved exactly in the quota result. Existing quota diagnostics are stderr-shaped, so “retains diagnostics” is insufficient.

- State and document that adapter-boundary classification applies to all Claude callers using that adapter, while fallback remains each mode’s existing quota path. This preserves the intent’s no-special-case boundary and makes cross-mode behavior reviewable.
