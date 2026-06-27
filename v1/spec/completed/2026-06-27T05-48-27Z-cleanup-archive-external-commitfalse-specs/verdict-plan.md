## Verdict

Three refinements are required.

**1. Ready-intents prune filename — Decisions and AC must be corrected**

The current Decisions section says to prune `ready-intents/<specName>.md`, and the corresponding AC says "its `ready-intents/<specName>.md` is removed." When an archive is matched via timestamp-stripped slug (the plan-branch case), the archive source's basename is the full timestamped dir name (e.g., `2026-05-17T22-14-03Z-my-feature`), not the branch slug. But the ready-intent file is derived from the branch slug (`my-feature.md`). An implementer following the spec literally for the timestamp-matched case would attempt to prune the wrong filename and silently fail. The Decisions section must explicitly state that the ready-intents prune filename is the branch slug (e.g., `my-feature`), not the archive-source basename. The AC must reflect the same (e.g., "its `ready-intents/<branchSlug>.md` is removed"). This is load-bearing: the wrong choice is plausible and leaves behind exactly the artifact cleanup is meant to eliminate.

**2. Non-plan `commit:false` exact-match path needs an AC or an explicit scope exclusion**

The spec's Decisions section acknowledges an exact-match path for non-plan branches, but no AC exercises it. An implementation that only enters the external archival branch when the branch name starts with `plan/` would pass all existing ACs and silently fail for a non-plan `commit:false` worktree. The spec must either add an AC verifying that a non-plan `commit:false` branch with an exact-match external spec dir archives correctly, or add a Decisions entry explicitly stating that non-plan external branches are out of scope (with rationale).

**3. `CleanupCommandOptions` interface fields must be named in Decisions**

The Decisions section states the CLI passes the `commit` flag and external specs root into `CleanupCommandOptions`, but does not name the new fields. Tests for the external path need to inject these values cheaply (without a full config file on disk). The Decisions section must name the fields added to `CleanupCommandOptions` (e.g., `commit: boolean`, `externalSpecsRoot?: string`) so implementers and test authors share a concrete target and won't diverge on injection approach.