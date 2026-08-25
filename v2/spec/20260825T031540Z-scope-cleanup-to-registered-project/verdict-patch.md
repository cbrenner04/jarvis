- Named cleanup must fail closed for repositories shared by multiple registered project keys. `jarvis cleanup <project>` must not prune a shared Git ref while checking durable or daemon activity only under the selected key; all potentially owning registered projects must be considered or ambiguous pruning refused. Add regression coverage for linked registered roots sharing one Git common directory. This preserves the spec’s safety gates and “never mutate another project” contract.

- Correct the README command catalog to show `jarvis cleanup [<project>]`, all supported flags, and the project/`--abandon` mutual exclusion. The current syntax is obsolete and operator-facing.

- Update the first-workflow walkthrough to close `your-project` with named preview/apply commands and reserve bare cleanup for intentional all-project maintenance. This must align with the new concurrent-project workflow documented by the spec and operator runbook.
