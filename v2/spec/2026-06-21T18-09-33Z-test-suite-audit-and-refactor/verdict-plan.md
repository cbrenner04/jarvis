## Verdict

The draft is well-structured (directory-clustered, suite-green steps, audit-first) but has two must-fix ambiguities and several worthwhile clarifications before it is implementable.

### Required refinements (must fix)

**R1 — Reconcile the durable doc's own out-of-scope language.**
`v2/docs/test-writing.md` currently states under *Out of scope* that "converting existing tests" and "existing real-process tests" are out of scope — the exact work this spec performs. 00's documentation updates must strike or rewrite that clause so the durable convention does not directly contradict the work it now sanctions. Without this, the spec ships a doc that disavows its own product.

**R2 — Pin the `marked-exception` / "green" contract.**
The spec hinges on a `.sandbox-unrunnable.test.ts` marker but never states (a) in which environment "suite stays green" is measured, and (b) whether a marked file gets actual runner exclusion or is simply expected to pass when the suite runs sandbox-off. There is no exclusion wiring in the repo today, and `bun test --parallel` collects these files — so "green in-sandbox" and "marked real-process tests exist" are only mutually consistent if the spec says green is measured sandbox-off (or adds an exclusion glob). 00 (or the index) must state this explicitly. This is load-bearing for 02–05's green criteria.

**R3 — Make the deterministic-real-process verdict rule explicit.**
The taxonomy defines `already-deterministic` as "no real OS process," which mislabels a *deterministic but not sandbox-runnable* real-git test — it is neither truly `already-deterministic` nor a non-determinism `refactor`. 00 must state the decision rule: a deterministic real-process/git test goes to `marked-exception`, **kept not mocked** (mocking working integration coverage is itself the over-mocking smell the intent targets). This closes the gap without adding a fourth verdict. Couple this with R2 since both concern the marked-exception slot.

### Worthwhile refinements

**R4 — Scope or split 02 (`run.test.ts`).**
A full clock+spawn+git seam conversion of a ~6.9k-line integration test is not accurately described as "mechanical, additive DI seam," and it risks blowing the ~1000-line reviewability budget. 02 should either scope explicitly to named assertion groups (early-interrupt, elapsed-bound, descendant-capture) with the irreducible remainder routed to a marked-exception sibling, or be split into multiple subspecs. This is the riskiest estimate in the spec.

**R5 — Close the orphaned-file scope gap.**
Clusters 01–05 enumerate 33 files; `test/test-slices.test.ts` is under `test/` (no cluster covers it) yet 00's AC demands a verdict for every matching file under `v1`/`v2`/`shared`/`test`. Either assign it to a cluster/an already-deterministic bucket, or state that 00 may close a file as `already-deterministic` with no cluster assignment.

**R6 — Give 05's "no net coverage loss" a baseline.**
The preservation AC is hard to falsify without a snapshot. 00 should capture a lightweight baseline in `findings.md` (per-refactor-target assertion inventory, plus coverage numbers if the repo emits them) so 05 has a concrete artifact to check against, consistent with the refactor-AC citation style in spec guidance.

### Minor polish (non-blocking)

- **R7** — Drop the "~35" guess from 00's authoritative inventory; let the recorded scan command produce the count (the inventory deliverable shouldn't hedge its own number).
- **R8** — Soften the v1-behaviors.md instruction: record a seam there *only if* it alters an observable default; pure test-only optional params (defaulting to the real impl) are not observable behavior and need no entry, matching that catalog's purpose.
- **R9** — State concretely what 00 *adds* (the smell checklist) versus what the prerequisite convention already provides (the determinism rules + serial-retry gate), so checklist ownership isn't double-claimed.

### Rationale

R1–R3 are correctness/coherence defects: the spec currently contradicts a durable doc (R1) and leaves its central green/marker contract underspecified (R2/R3), which the intent's "suite stays green throughout, mechanical and correctness-preserving" mandate makes load-bearing. R4 enforces the spec-guidance reviewability warning and the intent's "explicitly sequenced subspecs, not one big-bang." R5–R6 close falsifiability and scope-completeness gaps in the audit's own acceptance criteria. Minors align prose with repo conventions.

### Cleared (no action)

Serial run via plain `bun test` matching `ready.ts`'s serial path; `findings.md` as generated evidence in the spec dir; isolating `run.test.ts` into its own subspec — all correct as drafted.