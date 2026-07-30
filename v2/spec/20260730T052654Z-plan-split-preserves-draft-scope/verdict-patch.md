Reviewing the implementation and related specs to issue a self-contained verdict.
## Verdict

No required outcomes. Merge as-is.

The implementation satisfies the completed subspec and verdict-plan refinements:

- `## Decisions`, `## Acceptance criteria`, and `## Documentation updates` are partitioned per AC-derived boundary via the shared classifier, not duplicated across children.
- Multi-surface bullets in any of the three sections hard-error before emit.
- Unclassified bullets land on the first boundary child.
- Split-residue lines are excluded from the preservation oracle; manifest per-child equality on k2/k3 is ground truth, with union-equals-surviving-parent as a structural consequence.
- Inverting the partition guard turns k2 RED for all three preserved sections.

**Upheld but not blocking**

1. **Classified decisions/docs on surfaces outside the AC union can be silently omitted from every child.** That is consistent with the classifier contract (boundaries come only from AC text) and this subspec’s scope (partition across those k boundaries). It conflicts with broader intent wording (“none is dropped”) but is not pinned by this subspec’s acceptance criteria or fixtures. Follow-up: hard-error or an explicit draft-authoring invariant when a classified decision/doc surface ∉ AC boundary set.

2. **Multi-surface hard-error is only negatively tested via an AC mutation.** Decision/doc scanning shares the same `ambiguous` path but lacks dedicated negative coverage. Reasonable hardening; not required by this subspec’s ACs (verdict-plan marked non-blocking).

3. **Stale test title** (“multi-surface acceptance criterion” vs “multi-surface bullet”): cosmetic only.

**Not upheld as merge requirements:** k3 invert coverage, write-path integration for decisions/docs, intro-prose duplication (explicitly out of scope), operator docs (deferred per subspec), `- None.`-only edge case, line-level vs block-level test oracle mismatch with current single-line fixtures.