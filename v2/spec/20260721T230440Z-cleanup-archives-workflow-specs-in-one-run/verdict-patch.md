- Resolve the retired worktree’s actual workflow spec identity across all durable rows. Newer review rows such as `implement-review` pointing to `verdict-patch.md` must not mask the implemented spec recorded by an earlier workflow row. Otherwise one cleanup can fail to archive the eligible spec, violating the same-invocation requirement.

- Add regression coverage for the normal reviewed-workflow row sequence: a newer review artifact row plus the implement row must still result in archiving the implemented spec, with an immediate second cleanup finding nothing new.

- Make the incomplete-spec regression workflow-produced by using a non-null workflow `stepId`, and verify cleanup leaves it open while naming its unchecked acceptance criterion. This is required to substantiate the completed workflow-specific acceptance criterion.
