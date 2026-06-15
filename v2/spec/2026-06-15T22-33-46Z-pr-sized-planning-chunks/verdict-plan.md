I've verified every load-bearing claim against the source. Issuing the verdict.

## Verdict

The doc subspec (00) is structurally sound; its deliverable is correct. Subspecs 01 and 02 rest on a partly-wrong model of the live plan-review pipeline and the snapshot-test harness, and must be refined before they are implementable. Required refinements:

### 1. Subspec 02 must target the live verdict-authoring surface, not the dead `review.md` (critical)

The running plan-review pipeline is **adversary → advocate → adjudicator → actuator**. The role selector only ever instantiates adversary, advocate, or adjudicator; `plan.prompt.review` (`review.md`) is referenced by no live plan-run code path (only by registry/snapshot tests). Editing it does nothing for actual plan runs.

More importantly, the **adjudicator authors the verdict the actuator consumes**, and the actuator is constrained not to act beyond that verdict. As written, 02 edits the adversary (flag) and actuator (split) but never the adjudicator — so an oversize finding can be raised by the adversary and then die at an unmodified adjudicator. The intent's flag→split loop does not close.

- 02 must edit `review-adjudicator.md` so an oversize-subspec finding is escalated into the verdict the actuator acts on. Replace `review.md` with `review-adjudicator.md` as the verdict-bearing surface throughout 02.
- Drop the `review.md` edit/revision-bump/fixture work from 02 — it is wasted motion on a dead prompt. (Leaving `review.md` untouched keeps its existing `.toBe("6")` assertion and fixtures valid.)
- Keep the advocate edit: `review-advocate.md` carries `SPEC_GUIDANCE` and the adjudicator weighs the advocate's response, so the same-lens rationale holds.
- The minimal correct live edit set is **adversary (flag) → adjudicator (escalate into verdict) → actuator (split)**, plus advocate (same lens).

### 2. Both 01 and 02 must update the hardcoded revision expectations (critical)

`rendered-snapshots.test.ts` asserts exact revisions via `.toBe(...)` (currently draft=7, review.adversary=2, review-actuator=2, among others). "Bump the revision + add a fixture" as written leaves these stale assertions failing, so a literal implementer gets a failing `bun test` — contradicting the AC that `bun test` passes. Each subspec that bumps a prompt revision must explicitly include updating the corresponding hardcoded revision expectation in that test.

### 3. Subspec 02 must fix its fixture acceptance criterion to match the actual snapshot harness (critical)

Rendered snapshot fixtures exist and are asserted only for a fixed set of prompts — including the **adversary** and **actuator** but **not the advocate or adjudicator**. 02's blanket AC "each edited review prompt has a matching rendered snapshot fixture" is unsatisfiable for the advocate and adjudicator as the harness stands. 02 must either:
- scope the fixture/snapshot requirement to the prompts the harness actually renders (adversary, actuator), and require only a revision bump for the advocate/adjudicator; **or**
- explicitly take on adding the advocate/adjudicator to the snapshot harness as named, in-scope work (with the attendant test wiring).

Either way the AC must stop asserting a fixture for prompts the harness does not render.

### 4. Subspec 00 must correct its prompt enumeration (minor)

00's parenthetical claims `SPEC_GUIDANCE` is injected into "(draft, review, adversary, advocate, actuator)." That omits the adjudicator and lists the dead `review`. The substantive claim ("stating the rule here reaches all prompts") is true — every live prompt including the adjudicator carries the `SPEC_GUIDANCE` placeholder — but the enumeration misleads 02's implementer about which surfaces are live. Correct it to the live set (draft, adversary, advocate, adjudicator, actuator).

### 5. Note the `v1-behaviors.md` merge ordering (minor)

All three subspecs append to `v2/docs/v1-behaviors.md`, so as three independently-mergeable PRs they will textually conflict on merge. Entries are small and append-only; add a one-line merge-ordering note rather than restructuring. This is inherent to the PR-sized-chunk goal and not a defect.

---

Rationale: refinements 1–3 are correctness blockers — without them the spec's central loop (review flags → actuator splits) silently fails to close, and the acceptance criteria are literally unsatisfiable against the current test harness, violating the spec-guidance requirement that each subspec be independently implementable and verifiable. 4–5 prevent the implementer from being misled and are cheap. The doc-side approach (single numeric-threshold home in `spec-guidance.md`, prompts referencing the rule without the number) is correct and consistent with the plan-prompt-coherence principle; no change needed there.