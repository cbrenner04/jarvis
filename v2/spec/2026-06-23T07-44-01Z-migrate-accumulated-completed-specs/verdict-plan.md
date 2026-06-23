## Verdict

The spec is fundamentally sound — the classification verdicts are correct and the move logic is clean. Four refinements will close real gaps; one finding is correctly out of scope.

**Required refinements:**

1. **Reconcile "v2 holds only genuine v2 planning" with "no reference fix-ups."** The two trees being moved contain internal `v2/spec/...` cross-references (e.g., `v2-meta-index.md`, `intent.md`). A later reviewer could read the intent's "only genuine v2 planning remains" plus the no-fix-ups decision as a missed cleanup. The spec must state explicitly that internal historical `v2/spec` cross-references *inside the moved trees* are intentionally retained as frozen records, not live links. This is the highest-value change — it prevents a future false-positive without altering behavior.

2. **State the classification rule precisely.** The verdicts actually applied "any change under `v1/**` → v1" (coding-standards touched root `prompts/` + `shared/` yet correctly "stays" because nothing under `v1/**`). The "v1-favoring/mixed → v1" phrasing understates that precision and invites a future reviewer to misapply it to a shared-only spec. Tighten the rule wording to the reproducible form actually used.

3. **Name the grading method for "byte-identical."** Post-merge there is no in-tree before-image, so "byte-identical as before the move" is only checkable via rename-tracking (content-preserving rename / `git log --follow`). Make AC #1 self-gradeable by naming how the no-content-delta property is verified.

**Not required:**

- **First-write-behavior verdict (v1):** already correct and already records the changed surfaces (incl. `v1/src/worktree.ts`) so a reviewer can re-check. The presence of additional v2 code does not flip a spec that refactored shipping v1 code. No change.
- **This spec's own home under `v2/spec`:** out of scope. Where the migration spec lives is a config-driven authoring concern orthogonal to what it does; relocating it would be scope creep against the clean one-subspec boundary. An optional one-line note acknowledging this is config-driven would preempt reviewer confusion but is not required.

**Rationale:** #1 and #2 serve the intent's stated end-state ("v2/spec = genuine v2 planning") by making the retained-reference decision and the routing rule unambiguous and reproducible. #3 satisfies the spec-guidance requirement that acceptance criteria be independently verifiable. All three are clarifications, not behavior changes.