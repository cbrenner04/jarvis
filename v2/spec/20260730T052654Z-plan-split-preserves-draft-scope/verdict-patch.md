Reviewing the implementation and spec to validate the advocate's claims before issuing a verdict.
## Verdict: required outcomes

### 1. Empty optional sections must not delete the following heading

When a non-first emitted child receives zero bullets for an optional partitioned section (`## Decisions` or `## Documentation updates`), split output must retain every subsequent section heading and its content. Removing an empty optional section must not consume the next `##` heading.

**Rationale:** Current empty-section handling removes one line past the section boundary, which collapses the next section (typically `## Acceptance criteria`) into the prior section. That corrupts emitted subspec structure on a reachable path whenever all bullets in an optional section classify to other boundaries. The preservation fixtures do not exercise this path; a fixture must pin it.

### 2. Classified bullets outside the acceptance-criteria boundary set must not be silently dropped

A decision or documentation bullet that classifies to exactly one known surface, but that surface is not among the boundaries derived from the draft’s acceptance criteria, must not vanish during partition. Split must hard-error with a deterministic message (same posture as multi-surface bullets), not omit the bullet.

**Rationale:** Partition boundaries are derived only from acceptance criteria, while decisions and documentation bullets use the same classifier. A single-surface bullet for a boundary absent from the AC union currently matches no child filter and is dropped with no error. That contradicts the intent that every drafted decision, criterion, and documentation bullet appears in exactly one emitted subspec. The completed spec covers multi-match (hard-error) and zero-match (first child) but leaves this gap; hard-error is the consistent, testable closure.

### 3. Add regression coverage for both outcomes above

`shared/module-boundary-surfaces.test.ts` (or the committed fixtures/manifest) must fail on the pre-fix behavior and pass after the fixes:

- A split where a non-first child legitimately has an empty optional section still emits intact downstream headings with correct per-child bullets.
- A draft whose decisions or documentation bullets classify to a surface not present in the AC-derived boundary set causes `normalizePlanDraftSpecDir` to throw before writing children.

**Rationale:** Both defects are latent under the current k2/k3 fixtures. Manifest per-child equality does not catch them.

---

## Not required

- **AC3 / invert-guard / pre-change RED claims:** Satisfied by the repo’s diff-derived mutation verifier at completion gate; no hand-written inversion test is required in this module (same convention as the sibling classifier spec).
- **Union oracle via manifest:** Per-child emitted-vs-manifest equality plus manifest-vs-surviving-parent union is spec-compliant; no change needed.
- **H1 title when `## Decisions` is absent:** Title rewrite runs before the missing-section early return; no defect.
- **Multi-surface `## Documentation updates` dedicated test row:** `assertNoMultiSurfaceBullets` already walks all partitioned sections; an extra `test.each` row is optional polish, not merge-blocking.
- **First-child floor ordering, body duplication for non-preserved sections, exported `splitResiduePattern`:** In scope per spec decisions or deferred to the dependency-ordering spec; no action here.