## Verdict: required refinements

### 1. Align the preservation oracle with split-residue stripping
The acceptance criteria must not require a literal full-parent union. The spec already excludes split-residue-stripped lines from the preservation set; AC1 must use the same “surviving parent” definition so implementers cannot satisfy the spec with an impossible oracle.

### 2. Unify test oracle: manifest per-child equality for all three preserved sections
Decision #5, the tasks, and the acceptance criteria currently read as two designs (committed manifest vs runtime union checks). The spec must state one contract: committed `manifest.json` per-child expectations are ground truth for `## Decisions`, `## Acceptance criteria`, and `## Documentation updates`, with union/exactly-once checks as structural consequences of that manifest—not a weaker substitute. Acceptance criteria must require manifest equality for decisions and documentation bullets the way the sibling split fixture already does for acceptance criteria, so wrong-child placement (exactly once but on the wrong boundary) is caught.

### 3. Define multi-surface behavior for decisions and documentation bullets
Reusing the acceptance-criteria surface classifier for decisions and docs is stated, but behavior when classification returns multiple surfaces is unspecified. The spec must inherit the same rule already fixed for acceptance criteria (hard-error or explicit assignment)—not silence—so partition behavior is deterministic and testable.

### 4. Add `## Evidence` to the non-verbatim section list
Intent exempts evidence from exactly-once verbatim preservation; the subspec’s non-verbatim decision only names Problem and task-checklist. Add Evidence so drafts with evidence sections are unambiguously out of scope for verbatim distribution.

### 5. Add pre-fix failure claims for new preservation assertions
Per spec guidance for runtime-behavior changes, AC1 (and AC2 if documentation bullets are duplicated today) must state explicitly that the new fixture assertions fail against the current emit-as-drafted/duplicated-body path before the fix lands.

### 6. Clarify invert-guard acceptance criterion scope
AC3 must name what turning RED when the guard is inverted: the combined partition/preservation step for decisions, acceptance criteria, and documentation bullets (i.e., inverting it must fail both preservation ACs, not only the k2 acceptance-criteria case).

---

## Rationale (concise)

Items 1–2 prevent contradictory or incomplete test oracles—the core intent is verbatim partition without drop or duplicate, and manifest per-child is the only way to pin correct boundary ownership. Item 3 closes a classifier edge case that would otherwise leave implementers guessing. Item 4 aligns the subspec with stated intent. Items 5–6 satisfy failing-test and guard-inversion requirements from spec guidance.

## Not required (no blocking refinement)

- First-child floor for unclassified bullets (consistent with existing acceptance-criteria behavior; optional explicit tie-in only).
- Misclassification as a preservation defect (out of scope; this spec distributes verbatim text using the existing classifier).
- k3 invert extension, parent `## Tasks` policy line, doc-bullet edge cases (`- None.`, absent sections), bullet-parsing cross-reference, prerequisite restate in subspec, or integration/write-path coverage (clarifications or repo precedent; not merge blockers).
- Subspec split: single atomic subspec on `normalizePlanDraftSpecDir` remains appropriate; no index split required.