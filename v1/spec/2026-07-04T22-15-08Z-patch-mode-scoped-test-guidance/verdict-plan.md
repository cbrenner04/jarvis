## Verdict

Four refinements required in `00-scope-agents-md-test-instruction.md`:

1. **Pin the diff base.** The instruction must specify what "touched files" is measured against, since a subspec can span multiple commits touching different surfaces and this changes which test script actually runs. Add to Decisions: the comparison is against the branch/merge-base (all files changed across the active subspec's work so far), not just the last commit or working-tree diff. Reflect this in the rewritten `AGENTS.md` guidance itself, not only in the spec's Decisions section.

2. **Guard against plan-mode leakage.** The intent explicitly marks plan-mode test execution as out of scope. Since the target sentence lives in prompt material shared by both patch and plan mode, the rewrite must preserve (not just implicitly retain) the tie to "before ticking acceptance criteria" so the instruction stays legible as patch-mode-only. Add a task item and acceptance criterion requiring the new wording to keep this scoping explicit.

3. **Evidence the doc sweep.** The Decisions section's claim that no other doc needs editing currently rests on checking only `operator-runbook.md`, but the intent asked to check "any other agent-facing doc." Require the subspec to record what was searched (e.g., a grep for `bun run test` / full-suite instructions across `v1/docs/` and root docs) to substantiate the "no edit needed" conclusion, not just assert it against the one file named in the intent's example.

4. **Preserve the adjacent `ready`-gate clause.** The target sentence sits next to unrelated guidance (don't run `bun run ready`). Add a task/AC constraint that the rewrite must leave that adjacent instruction intact, since "replace the line" as currently worded invites collateral loss.

No scope expansion or subspec split is warranted — all four are precision/evidence fixes within the existing single subspec.