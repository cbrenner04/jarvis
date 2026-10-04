## Verdict — required outcomes

1. **`v2/spec/v2-meta-index.md` Phase 5 line must state the taxonomy prohibition.** The subspec decision requires the design gate in *both* tracking docs: Phase 5 must not proceed against retired category taxonomy. Build-order already says `— not category taxonomy`; meta-index cites the dependency on `role-resolution.md` and `agent-model-config.md` on `main` but omits the prohibition. An operator reading only the meta-index line lacks the gate half that build-order carries.

2. **`v2/docs/v2-build-order.md` Phase 5 design-gate prose must satisfy acceptance criterion #2 as written.** Current wording (`Depends on … on main — not category taxonomy`) is semantically close but not literal: AC #2 requires that planning and implementation depend on those docs **committed on `main`**, and that Phase 5 **must not use retired category taxonomy**. Close the gap so the checkbox matches the criterion, not a paraphrase.

---

**Rationale:** Role→model contract tokens, banned category-resolution strings, forward refs, quota bullets, and the `role-resolution.md` deferral retraction are in place. The remaining gaps are design-gate completeness: one tracking doc omits the taxonomy ban the subspec decision mandates for both, and build-order gate wording falls short of the tightened AC #2 tokens from verdict-plan refinement #5.

**Not required:** Advisory “depends on” vs mechanical “blocked” (subspec decision); bare filenames in meta-index; `→ model` shorthand elsewhere; meta-index/build-order changelog in `role-resolution.md`; `v2-vision.md` / `v2-architecture.md` alignment; Phase 6 meta-index role-name drift; historical completed-spec scrubbing.
