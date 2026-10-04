# Adjudicator verdict — required refinements

## 1. Pin boundary classification mechanism and vocabulary

The spec must state how acceptance-criterion text is mapped to module boundaries. Today “same as intent split” has no stable, committed definition in the repo, and a sibling intent deliberately avoids enumerating surfaces in prompts. The spec already rules out prompt-only enforcement, which implies harness-side classification unless that choice is reversed.

**Required outcome:** One explicit contract—either this work owns the canonical surface list (or equivalent classifier) that later intent-split work reuses, or classification stays agent-side and the harness only validates/normalizes staged output. The contract must be testable and referenced from documentation subspec `02`, not from unmerged prompt-only work.

**Rationale:** Without this, implementers can ship divergent semantics from the intent and from downstream ready-intents; docs would describe behavior that has no single source of truth.

---

## 2. Split subspec `00` into independently testable subspecs

Subspec `00` bundles classification, staged-tree split/renumber/index rewrite, v1 draft-validation integration, v2 plan write staging, and (currently) a prompt change. Those are separable behaviors with distinct verification surfaces.

**Required outcome:** Replace the monolithic `00` with multiple index-linked subspecs such that each has atomic acceptance criteria; every task and acceptance outcome from the current `00` appears exactly once across the replacements. Sequencing in `index.md` should reflect dependencies (e.g. pure classifier/transform before wiring).

**Rationale:** Spec guidance requires atomic, independently testable subspecs; the highest-risk piece (classification) should not be buried in a single implement slice.

---

## 3. Prove or defer v2 normalization

A decision in `00` requires the same normalization on v1 and v2 paths, but acceptance criteria only pin v1 behavior and `01` only preserves existing v2 tests.

**Required outcome:** Either add a worktree-verifiable acceptance criterion that normalization runs on the v2 plan write/staging path (failing-test style against pre-change behavior), or remove v2 from the parity decision and defer v2 to a named follow-on subspec/intent. Do not assert v1/v2 parity without a matching AC.

**Rationale:** Untested parity decisions become silent drift between engines.

---

## 4. Pin a single v1 enforcement hook

Two `validateDraftOutput` call sites create a risk that normalization runs on draft-commit but not on recovery/resume.

**Required outcome:** The spec must state that boundary normalization runs on every path that validates/commits plan draft output (including recovery), by naming the shared entry point or equivalent—not “wire beside one call site.”

**Rationale:** Partial wiring would leave multi-boundary drafts published on some plan paths only.

---

## 5. Floor rules for deferred split semantics

Deferring full AC-to-child assignment and non-AC preservation to `plan-split-preserves-draft-scope` is acceptable, but the deferral must not allow implementations that drop criteria or emit hollow subspecs.

**Required outcome:** Add minimal invariant decisions: (a) an acceptance criterion that names more than one boundary is never silently dropped (assign or hard-error); (b) criteria that match no known surface are treated as single-boundary for split purposes (no split triggered solely by unclassified text).

**Rationale:** Intent requires split-on-emit, not worse-than-draft trees; downstream intents should refine assignment, not rescue data loss.

---

## 6. Strengthen test and AC contracts in the split/normalization subspec(s)

Refinements needed without prescribing implementation:

- **Fixture depth:** Extend coverage beyond two boundaries (e.g. k=3) where the decision already allows arbitrary k.
- **Anti-circularity:** Multi-boundary tests must assert literal expected child acceptance text (or equivalent ground truth), not outcomes produced by re-invoking the classifier under test.
- **Guard inversion:** Name the specific detection guard or symbol in the inversion acceptance criterion once subspecs are split.
- **Test path:** Use one committed test module path (no “or adjacent”); avoid collision with existing write-boundary tests (e.g. distinct filename from `boundary.test.ts`).
- **Provenance:** Broaden the no-provenance AC beyond parent-title tokens—cover forbidden phrases, parent slug references, and planning-label residue across bodies, filenames, and index link text per intent.
- **Prompt task:** Remove the plan-draft prompt-change task from this spec (intent rules out prompt-only enforcement; prompt surfacing belongs with intent-split prompt work unless mechanism (1) chooses agent-side classification).

**Rationale:** Spec guidance requires named failing tests for new behavior, guard inversion for new guards, and agent-verifiable ACs; narrow provenance checks can pass while violating “no planning labels.”

---

## 7. Align documentation subspec with pinned vocabulary

Subspec `02` must describe plan-step splitting and the one-boundary-per-subspec rule using the same canonical boundary definition chosen in refinement (1), and must keep `v2/docs/v1-behaviors.md` validation order consistent with where normalization runs (refinement 4).

**Required outcome:** Operator docs cite the spec-owned contract, not an unenumerated or prompt-only vocabulary.

**Rationale:** Intent documentation updates must match enforceable behavior; `v1-behaviors.md` update for behavior changes remains correct per repo guidance.

---

## 8. Scope clarification (decision only)

Add a short decision that normalization applies to plan-step staged output before validation/publish, not to arbitrary operator hand-edits on an already-open plan PR (outside the plan draft pipeline).

**Rationale:** Avoids false expectations about re-splitting on manual PR edits; resume paths are covered by refinement 4.

---

## Not required (findings rejected)

- Dropping `v2/docs/v1-behaviors.md` from `02` (behavior change → catalog update is correct).
- Empty `## Prerequisites` or deferring sibling index ordering to `plan-split-index-orders-by-dependency`.
- Splitting `01` solely because it is regression-heavy (intent AC #2 and index ordering after `00` remain valid). After `00` splits, `01` may stay as pass-through pinning or absorb naturally—refiner’s choice as long as outcomes are preserved.

---

**Summary:** Ship-blocking gaps are unpinned classification/vocabulary, an oversized `00`, and unproven v2 parity. Required work: mechanism contract, subspec split with full outcome coverage, v1 single-hook + v2 prove-or-defer, deferral floors, and tightened test/doc ACs as above.