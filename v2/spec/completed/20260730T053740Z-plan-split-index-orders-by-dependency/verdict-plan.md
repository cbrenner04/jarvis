Verifying the advocate's central claims against the codebase before issuing the verdict.
# Adjudicator verdict

Required refinements before this spec is implementation-ready:

---

**1. Own first-child semantics when dependency order inverts canonical order**

The subspec claims it “only reorders” and defers scope partitioning to `plan-split-preserves-draft-scope`, but today zero-surface acceptance criteria attach to `boundaryIndex === 0` — whichever sibling is emitted first. Reordering siblings therefore changes scope partitioning, not just checklist sequence.

The spec must decide and state: when draft-declared dependency order puts a non-canonical surface first, zero-surface ACs (and, by alignment with the preservation sibling, unclassified non-AC bullets once that work lands) follow **dependency-first** emission, not canonical `MODULE_BOUNDARY_SURFACES` order.

The dependency-order fixture must either assert that floor on the dependency-first child or explicitly exclude zero-surface lines until preservation pins them. Without this, two same-seam specs can ship incompatible “first child” contracts.

*Rationale:* Intent is runnable implement order; hidden coupling between ordering and AC assignment defeats that and conflicts with the preservation deferral chain.

---

**2. Pin the no-signal default explicitly**

Deferring tie-break “to first consumer” leaves canonical-order fallback implicit. The spec must state that when split siblings have no declared cross-boundary ordering signal, emission order stays `MODULE_BOUNDARY_SURFACES` array order (current k2/k3 behavior).

*Rationale:* Existing manifest tests exercise k2/k3 every run; an explicit decision prevents implementers from changing the no-signal path without intent.

---

**3. Define draft-signal bounds and failure modes**

Ordering-signal parsing is example-driven. The spec must decide:

- **Sections in scope:** `## Decisions`, `## Tasks`, and `## Prerequisites` only; other sections (e.g. `## Problem`) do not supply ordering edges.
- **Surface resolution:** ordering endpoints use the same surface classification path as AC partitioning (`classifyModuleBoundaryText` or equivalent shared resolution), so prose “CLI” in an edge and AC assignment cannot diverge.
- **Cycles/contradictions:** hard-error (consistent with existing multi-surface AC hard-error), not silent winner-picking.
- **Precedence (v1):** explicit Decisions/Tasks edges beat Prerequisites; finer multi-signal precedence may defer but must not be left ambiguous for conflicting explicit edges.
- **Partial orders:** topological sort with canonical tie-break for unconstrained siblings; explicit signals beat AC checkbox order when they disagree.

*Rationale:* Intent requires honoring declared implement-before edges and forbids inventing order; without bounds and error behavior, implementers will guess and fixtures will not catch regressions.

---

**4. Make manifest the oracle for index link order, not filename sort alone**

Tasks and ACs require index checklist order to match sibling order, but the committed manifest today only records `expectedChildren[].file` and tests never parse `index.md` link sequence.

The spec must state how the manifest encodes expected index link order and how tests assert it — e.g. `expectedChildren` array order is authoritative for both emitted filenames and index link sequence, or a dedicated ordered index-link field.

*Rationale:* Sorting `readdir` output can pass while `index.md` link order inverts; the intent contract is implement consumption order via the index.

---

**5. Align intent with subspec scope and documentation**

- Tighten intent problem/decisions: scope is **declared** implement-before edges in the draft, not reordering undeclared independent peers (canonical order remains acceptable when no edge is stated).
- Add `v2/docs/v1-behaviors.md` to intent documentation updates (subspec already requires it per spec guidance).
- Name the dependency-order fixture key (e.g. `k4`) in the invert-guard AC so failing-test traceability matches sibling specs.

*Rationale:* Intent is the operator-facing contract; drift from the authoritative subspec and spec-guidance doc rules creates review and implement confusion.

---

**6. Strengthen same-seam sequencing relative to `plan-split-preserves-draft-scope`**

Given first-child coupling (#1), the index serial note must be unambiguous about **merge order** when both specs touch `normalizePlanDraftSpecDir` — which tree lands first and which spec owns first-child floor semantics for zero-surface and non-AC distribution. “Plan serially” alone is insufficient when both change normalizer behavior and fixture manifests.

*Rationale:* Spec guidance requires same-seam siblings to land serially; coupled semantics without an explicit merge contract invite conflicting PRs and broken k2/k3 fixtures.

---

**No split required.** One subspec remains appropriately atomic if the refinements above are incorporated; scope is still a single normalizer seam with one new fixture and invert guard.