1. **Enforce normalization on every v1 plan-draft validation path.** Fresh and recovery flows must normalize non-blocked drafts through the shared validation entry before they can pass. Preserve existing blocker semantics. This is required by the documented `validateDraftOutput` order and v1 parity contract.

2. **Remove the v2 normalization bypass.** A plan draft—staged or recovered from durable output—must not complete without normalization. Missing or inconsistent index links must fail validation, not skip normalization and pass a shallow shape check.

3. **Make all-single-boundary trees true no-ops.** If no subspec spans multiple boundaries, filenames, numbering, subspec bytes, and `index.md` bytes must remain unchanged. Add coverage that detects renumbering and index/line-ending rewrites, as required by subspec 04.

4. **Enforce provenance removal across all durable output.** Split children must contain no forbidden lineage, parent slug, or planning-label residue in filenames, index links, or any body prose—not only headings. Cover preserved prose sections, while retaining unrelated draft scope or failing explicitly when safe preservation is impossible.

5. **Classify complete acceptance-criterion items.** Boundary and ambiguity detection must include wrapped continuation text belonging to each checkbox item, while remaining confined to `## Acceptance criteria`. Otherwise an emitted criterion can still own multiple boundaries, violating the one-boundary-per-subspec contract.
