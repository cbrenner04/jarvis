- Define “other presets” as `resolveWorkflowPreset`’s supported presets; `intent-reviewed` is public but not resolver-supported.

- Specify that both permitted `implement` positions remain pinned `write` steps with the existing role and prompt fields. This preserves the intent’s no-review-behavior boundary.

- Require regression coverage for the exact cardinality of every other resolver-supported preset. This makes “unchanged” observable rather than leaving a global validation regression untested.
