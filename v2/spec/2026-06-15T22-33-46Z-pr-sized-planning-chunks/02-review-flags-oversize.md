# 02 — Review surfaces flag oversize subspecs

The live plan-review pipeline is **adversary → advocate → adjudicator →
actuator**. The adversary critiques, the advocate responds, the adjudicator
authors the verdict, and the actuator applies it (and is constrained not to act
beyond the verdict). None of these check whether a subspec will produce a
reviewable PR. Close the loop: the adversary flags oversize subspecs, the
adjudicator escalates such a finding into the verdict, and the actuator splits
on it. Affected governed prompts: `review-adversary.md`
(`plan.prompt.review.adversary`), `review-advocate.md`
(`plan.prompt.review.advocate`), `review-adjudicator.md`
(`plan.prompt.review.adjudicator`), `review-actuator.md`
(`plan.prompt.review-actuator`).

`prompts/plan/review.md` (`plan.prompt.review`, the compressor) is on no live
plan-run path — the role selector only instantiates adversary, advocate, or
adjudicator. It is left untouched so its existing revision assertion and
fixtures stay valid.

Depends on 00 (the rule lives in injected `SPEC_GUIDANCE`).

## Decisions

- Edit adversary (flag) → adjudicator (escalate into verdict) → actuator (split),
  plus advocate (same lens). — rules out flagging at the adversary then letting
  the finding die at an unmodified adjudicator, leaving the loop open.
- Skip `review.md` (the compressor). — rules out spending revision/fixture churn
  on a prompt no live plan run renders.
- Reference the spec-guidance sizing rule; do not restate the number. — rules
  out hardcoding `1000` into prompt text.
- Update only review surfaces here; draft is 01. — keeps each a separate
  mergeable PR.
- Advocate gets the same lens so it does not defend an oversize subspec as
  in-scope. — rules out the advocate silently neutralizing a valid size finding.

## Task checklist

- `prompts/plan/review-adversary.md`: flag subspecs likely to exceed the
  spec-guidance reviewability warning and call for a split along independently
  observable behavior.
- `prompts/plan/review-advocate.md`: treat oversize as a valid concern to
  address, not an over-reach to defend away.
- `prompts/plan/review-adjudicator.md`: when the adversary raises an oversize
  finding (and the advocate has not validly dismissed it), escalate it into the
  verdict so the actuator acts on it.
- `prompts/plan/review-actuator.md`: when the verdict calls a subspec oversize,
  split it (add/renumber subspec files, update `index.md`) per the sizing rule.
- Bump `revision` in each edited prompt (adversary, advocate, adjudicator,
  actuator).
- The snapshot harness (`rendered-snapshots.test.ts`) renders fixtures and
  asserts revisions only for the **adversary** (pass-1/pass-2) and **actuator**.
  For those two: add the matching `@r<n>` rendered snapshot fixtures under
  `v1/test/fixtures/prompts/rendered/` and update their hardcoded revision
  expectations (`review.adversary ...toBe("2")`, `review-actuator ...toBe("2")`)
  to the new revisions. The advocate and adjudicator are not rendered or asserted
  by the harness — bump their revision only; do not add fixtures for them.
- Record in `v2/docs/v1-behaviors.md`: plan review surfaces flag oversize
  subspecs and the actuator splits them before implementation. (Appends to the
  same file as 00/01; merge in index order to avoid a textual conflict.)

## Acceptance criteria

- [ ] `prompts/plan/review-adversary.md` instructs flagging subspecs likely to
      exceed the spec-guidance reviewability warning and calling for a split
      along independently observable behavior.
- [ ] `prompts/plan/review-adjudicator.md` instructs escalating a valid
      oversize-subspec finding into the verdict the actuator acts on.
- [ ] `prompts/plan/review-actuator.md` instructs splitting a subspec the verdict
      deems oversize, updating `index.md` and subspec numbering accordingly.
- [ ] `prompts/plan/review-advocate.md` treats an oversize-subspec finding as a
      valid concern rather than something to defend away.
- [ ] None of the edited review prompts state a numeric line threshold; they
      reference the spec-guidance sizing rule.
- [ ] `prompts/plan/review.md` (the compressor) is unchanged.
- [ ] Adversary, advocate, adjudicator, and actuator each have a bumped
      `revision`. The adversary and actuator have matching rendered snapshot
      fixtures and updated hardcoded revision expectations in
      `rendered-snapshots.test.ts`; no fixtures are added for the advocate or
      adjudicator. `bun test` passes (registry, renderer, snapshot tests).
- [ ] `v2/docs/v1-behaviors.md` records that plan review surfaces flag oversize
      subspecs and the actuator splits them.

## Documentation updates

- `prompts/plan/review-adversary.md`, `review-advocate.md`,
  `review-adjudicator.md`, `review-actuator.md` — the prompt changes (governed
  artifacts).
- `v2/docs/v1-behaviors.md` — parity baseline entry.
