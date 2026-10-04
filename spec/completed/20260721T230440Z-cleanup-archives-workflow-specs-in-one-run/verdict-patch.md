- Cleanup must resolve the actual durable spec artifact across all matching workflow rows. Newer review/verdict rows such as `implement-review`’s `verdict-patch.md` or reviewed-plan verdict artifacts must not override the authored spec identity.

- Add realistic multi-row regressions for default reviewed implement and reviewed plan workflows, proving one cleanup retires the worktree and archives the eligible spec in the same invocation.

- Preserve explicit `stepId: null` ad-hoc lookup, direct `listRuns()` usage, non-terminal eligibility checks, archival safety guards, and existing ad-hoc behavior.

These outcomes are required because the current newest-first selection can choose a verdict artifact, violating the completed spec’s durable-identity and same-invocation archival criteria.
