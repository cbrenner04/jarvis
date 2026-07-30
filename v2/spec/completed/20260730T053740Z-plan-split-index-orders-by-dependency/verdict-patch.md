Reviewing the implementation against the spec and adjudicator refinements before issuing the verdict.
# Adjudicator verdict

## Required outcomes

1. **Fix or remove the `## Prerequisites` `requires` / `depends on` ordering path.**  
   The spec treats `## Prerequisites` as an ordering-signal section whose bullets express earlier-surface work required before later surfaces. The current `depends on` / `requires` heuristic orders by mention position, which inverts natural prerequisite semantics (e.g. “CLI depends on persistence” would emit CLI first). That path is live but untested. **Outcome:** prerequisite bullets using `requires` / `depends on` must emit dependency-correct implement order, or the heuristic must be removed until a committed fixture pins the contract. Shipping the inverted heuristic conflicts with the spec’s Prerequisites semantics.

2. **Make the invert-guard acceptance criterion true in tests.**  
   The subspec requires that disabling dependency-order enforcement inside `normalizePlanDraftSpecDir` turns the k4 fixture path RED. The manifest normalization test would catch a full revert, but the dedicated invert-guard test only asserts positive ordering on the helper and does not invert or bypass enforcement in the normalizer. **Outcome:** add or replace coverage so k4 fails when `normalizePlanDraftSpecDir` no longer applies draft-declared order (not merely a positive assertion on `orderModuleBoundariesForSplit`).

3. **Reconcile `intent.md` acceptance criteria with landed behavior.**  
   Subspec and index checkboxes are complete; `intent.md` still lists the same behaviors as open. **Outcome:** tick the satisfied intent acceptance criteria (or otherwise align intent with the completed contract) so operator-facing spec artifacts do not contradict the implementation.

## Rationale

The k4 / index-order / zero-surface-first-child core matches the spec and adjudicator refinements: reordering drives emission and `index.md` link order, zero-surface ACs follow `boundaryIndex === 0` after reorder, no-signal siblings stay canonical, cycles/contradictions hard-error, docs are updated, and manifest `expectedChildren` order is asserted against both filenames and parsed index links.

The three items above are the upheld gaps that remain: one is incorrect behavior on a declared signal path, one is an explicit AC whose test does not match its wording, and one is spec-tree hygiene. Cross-section numbered-list chaining, broad `before` matching, and wider parser fixture coverage are reasonable hardening but not required to satisfy this tree’s stated acceptance criteria.