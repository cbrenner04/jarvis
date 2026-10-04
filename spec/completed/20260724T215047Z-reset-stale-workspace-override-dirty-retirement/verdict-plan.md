Verifying the listing-error / override seam claim in the codebase so the verdict is accurate.
## Verdict: required refinements before merge

1. **Override semantics when porcelain listing fails**  
   The spec must state whether the override applies only when the worktree is known dirty, or also when listing changes fails. Intent says skip **only** the dirty-worktree gate; the natural seam today (`enforceDirtyWorktreeGate: false`) also clears the listing-error refusal. The spec must pick one product behavior, reflect it in decisions, and require a test that would fail if the wrong branch is taken (fail-closed on error vs match disabled-gate behavior).

2. **Positive override AC: one canonical teardown baseline and a pinned test name**  
   Align intent, task checklist, and acceptance criteria on a single baseline for “same teardown as clean stale reset” (e.g. the existing `cleanup.test.ts` describe / `reset removes stale worktree and draft PR before re-run`). The new-behavior AC must name a concrete `workflow.test.ts` test title (spec guidance failing-test requirement), not only “adds a test” prose.

3. **Guard inversion called out explicitly**  
   Require an AC (or explicit citation of an existing seam test) that proves retirement does **not** run on a dirty incomplete re-run when the override is omitted—in addition to “existing test stays green,” so inversion is visible to implementers and validators.

4. **Preservation AC for seam dirty refusal**  
   Rewrite the `cleanup.test.ts` preservation criterion without “override omitted from workflow entry.” Those tests exercise `resetStaleWorkspace` directly; the contract is default gate-on refusal unchanged. Use refactor-style “named tests stay green” wording.

5. **Dirty refusal stderr: both layers, no “and/or”**  
   AC must require operator-facing `Cannot re-run incomplete spec: …` assertions in `workflow.test.ts` (override token plus commit, discard, `--abandon`) **and** seam/unit coverage that recovery copy / `reason` includes the wired flag token—matching the completed dirty-refusal observability split.

6. **Clarify “stays green” on the dirty workflow refusal test**  
   State that the refusal test remains the guard for no teardown without override, but assertions **must** be updated for extended recovery copy; “stays green” means refusal semantics unchanged, not zero test edits.

7. **Flag naming deferral vs this subspec**  
   Resolve tension between “defer exact flag name to first consumer” and tasks/AC that require a wired token. Outcome: decisions should say the name and help are pinned in **this** implementation slice (deferral applies to plan review only), or equivalent unambiguous wording.

8. **Prerequisites on the subspec**  
   Repeat intent’s dirty-refusal prerequisite under `## Prerequisites` on the subspec for standalone readability.

**Not required (optional hardening only):** plan-only CLI wiring AC; dirty + live-held/PR refusal combo with override set; second workflow test for untracked dirty on override success—unless product wants them; single implement workflow regression plus shared seam remains acceptable if decisions stay explicit.

**Upheld without change:** single atomic subspec scope; shared `maybeResetStaleWorkspace` for implement and plan; `--abandon` stays ungated; docs tasks match intent; override does not weaken earlier live-held/PR gates by design.