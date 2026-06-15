# 02 — Review surfaces flag oversize subspecs

The plan self-review surfaces critique the spec but never check whether a
subspec will produce a reviewable PR. Make them flag oversize subspecs and push
for a split before implementation. Affected governed prompts: `review.md`
(`plan.prompt.review`), `review-adversary.md` (`plan.prompt.review.adversary`),
`review-advocate.md` (`plan.prompt.review.advocate`), `review-actuator.md`
(`plan.prompt.review-actuator`).

Depends on 00 (the rule lives in injected `SPEC_GUIDANCE`).

## Decisions

- Adversary names oversize subspecs as findings; actuator splits them when the
  verdict requires it. — rules out a read-only critique that never reaches the
  spec files.
- Reference the spec-guidance sizing rule; do not restate the number. — rules
  out hardcoding `1000` into prompt text.
- Update only review surfaces here; draft is 01. — keeps each a separate
  mergeable PR.
- Advocate gets the same lens so it does not defend an oversize subspec as
  in-scope. — rules out the advocate silently neutralizing a valid size finding.

## Task checklist

- `prompts/plan/review.md` (compressor) and `prompts/plan/review-adversary.md`:
  flag subspecs likely to exceed the spec-guidance reviewability warning and
  call for a split along independently observable behavior.
- `prompts/plan/review-advocate.md`: treat oversize as a valid concern to
  address, not an over-reach to defend away.
- `prompts/plan/review-actuator.md`: when the verdict calls a subspec oversize,
  split it (add/renumber subspec files, update `index.md`) per the sizing rule.
- Bump `revision` in each edited prompt and add the matching rendered snapshot
  fixtures under `v1/test/fixtures/prompts/rendered/`.
- Record in `v2/docs/v1-behaviors.md`: plan review surfaces flag oversize
  subspecs and the actuator splits them before implementation.

## Acceptance criteria

- [ ] `prompts/plan/review-adversary.md` and `prompts/plan/review.md` instruct
      flagging subspecs likely to exceed the spec-guidance reviewability warning
      and calling for a split along independently observable behavior.
- [ ] `prompts/plan/review-actuator.md` instructs splitting a subspec the verdict
      deems oversize, updating `index.md` and subspec numbering accordingly.
- [ ] `prompts/plan/review-advocate.md` treats an oversize-subspec finding as a
      valid concern rather than something to defend away.
- [ ] None of the edited review prompts state a numeric line threshold; they
      reference the spec-guidance sizing rule.
- [ ] Each edited review prompt has a bumped `revision` with a matching rendered
      snapshot fixture; `bun test` passes (registry, renderer, snapshot tests).
- [ ] `v2/docs/v1-behaviors.md` records that plan review surfaces flag oversize
      subspecs and the actuator splits them.

## Documentation updates

- `prompts/plan/review.md`, `review-adversary.md`, `review-advocate.md`,
  `review-actuator.md` — the prompt changes (governed artifacts).
- `v2/docs/v1-behaviors.md` — parity baseline entry.
