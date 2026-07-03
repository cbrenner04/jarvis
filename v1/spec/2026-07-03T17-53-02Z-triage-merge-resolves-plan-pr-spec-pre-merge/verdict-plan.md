Verdict: Refine the spec to address the following.

1. **Specify the plan-branch detection predicate.** State explicitly how `deriveSpecPathFromBranch` identifies a `plan/*` branch (e.g. `branch.startsWith('plan/')`), and confirm this check gates the worktree fallback so non-plan branches never scan `worktreePath`. This is load-bearing: it defines the change's blast radius and must not be left implicit.

2. **Add a double-miss test case.** The task checklist only covers the success path (spec found via worktree fallback). Add an explicit test: a `plan/*` branch with no matching spec in either `projectRoot` or `worktreePath` still surfaces the original `no spec found for branch` error, rather than throwing or silently returning nothing.

3. **Clarify match priority in one sentence.** State that `projectRoot` is scanned first and `worktreePath` is only consulted on a miss — i.e. `projectRoot` wins if it happens to match. No new decision needed, just make the existing implicit ordering explicit in the Decisions section.

4. **Add acceptance criteria for the documentation updates.** The Documentation updates section (removing the operator-runbook "Known gap" paragraph, updating `v2/docs/v1-behaviors.md`) currently has no corresponding checkbox under `## Acceptance criteria`. Per this repo's spec guidance, doc updates are part of the work and must be gated the same as code — add ACs covering both doc edits.

5. **Verify and state the call-site count as fact, not assumption.** The spec asserts "the single call site in `resolveTriageNamedWorktree`" — this should be confirmed (via grep) and stated definitively in the spec rather than left as an unverified claim, since it determines whether any other caller needs a `worktreePath` argument too.

Not upheld / no action needed: reuse of existing candidate/timestamp matching logic in the worktree context is correctly scoped as out-of-scope (no new matching algorithm introduced); the "other callers" concern collapses into item 5 above and needs no separate treatment.