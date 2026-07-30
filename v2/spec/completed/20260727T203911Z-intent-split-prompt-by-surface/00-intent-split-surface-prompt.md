# Surface split rule in intent prompt

## Problem

`prompts/intent/split.md` tells the split step to fan out by independently observable
behavior (symptom slices). Cross-boundary fixes therefore land as one ready-intent and one
plan/implement run.

## Decisions

- Replace symptom/behavior-slice fan-out with module-boundary surface fan-out — rules out retaining
  dual fan-out axes or additive surface rules atop slice splitting.
- Split enumerates module-boundary surfaces the fix must change and emits one ready-intent per
  surface in dependency order — rules out one-intent-per-symptom and numeric file-count budgets.
- Genuinely single-**surface** seeds (one module boundary, not one symptom that spans several)
  emit one ready-intent; the ready-intent **body** states in one line why splitting does not apply
  (same placement `intent-split-multi-surface-regression` asserts) — rules out unsplit keyed to
  “one behavior” or rationale outside the body.
- The **new** surface rule is one added sentence with no examples or thresholds; conflicting
  symptom fan-out bullets are rewritten or removed — rules out treating the whole edit as literally
  one sentence or leaving case-list bloat.
- Multi-surface splits wire earlier-surface behaviors into later intents' `## Prerequisites`
  bullets in dependency order; remove or rewrite output bullets that forbid prerequisites or output
  order for cross-intent sequencing — rules out contradicting dependency-ordered surfaces.
- Pin the surface rule via a stable substring constant in `shared/prompts/intent-split.test.ts` —
  rules out paraphrase-only assertions that drift from the artifact.
- Introduce the split-prompt growth budget in this subspec: constant max delta over the pre-change
  `prompts/intent/split.md` artifact body length — rules out assuming a pre-existing budget test.
- Bump `revision` in `prompts/intent/split.md` frontmatter when the body changes — rules out a
  silent prompt change without governance-visible revision.

## Task checklist

- [ ] Add one new sentence to `prompts/intent/split.md` for the surface rule; rewrite or remove
      symptom/slice fan-out and conflicting ordering bullets; align output rules for
      dependency-ordered surfaces, cross-surface prerequisite behaviors, and single-surface unsplit
      body rationale without examples or numeric thresholds.
- [ ] Retain the spec-guidance reviewability reference; do not hardcode line counts.
- [ ] Add `shared/prompts/intent-split.test.ts` named guards: pinned substring, no
      symptom/slice fan-out remnants, single-surface unsplit body line, prerequisite-behavior
      wiring, artifact-body growth budget, no example/threshold patterns, and `revision` bump vs
      pre-change baseline.
- [ ] Export or colocate the pin constant so the inversion AC can negate it in-test.

## Acceptance criteria

- [x] `shared/prompts/intent-split.test.ts` test `intent split prompt pins surface fan-out rule`
      asserts `buildIntentSplitPrompt` output contains the pinned substring; it fails against the
      pre-change prompt; inverting the pinned substring turns this test RED.
- [x] `shared/prompts/intent-split.test.ts` test `intent split prompt rejects symptom slice fan-out`
      asserts the `intent.prompt.split` artifact body (and built prompt) does not instruct
      independently observable behavior/slice-based splitting or retain dual fan-out rules; it
      fails against the pre-change prompt.
- [x] `shared/prompts/intent-split.test.ts` test `intent split prompt requires single-surface unsplit`
      asserts output rules require exactly one ready-intent when the seed touches only one
      module-boundary surface, with a one-line unsplit rationale in the ready-intent body (not
      keyed to a single symptom spanning multiple surfaces); it fails against the pre-change prompt.
- [x] `shared/prompts/intent-split.test.ts` test `intent split prompt wires prerequisite behaviors`
      asserts output rules require dependency-ordered surfaces and earlier-surface behaviors in
      later intents' `## Prerequisites` without bullets that forbid prerequisites or ordering for
      cross-surface sequencing; it fails against the pre-change prompt.
- [x] `shared/prompts/intent-split.test.ts` test `intent split artifact growth stays within budget`
      asserts the registry artifact body for `intent.prompt.split` is at most the pre-change body
      length plus this subspec's max-delta constant; it fails against the pre-change artifact when
      the surface edit exceeds that budget.
- [x] `shared/prompts/intent-split.test.ts` test `intent split artifact has no examples or thresholds`
      asserts `prompts/intent/split.md` body contains no example blocks and no numeric split
      thresholds (symptom counts, file counts, line budgets); it fails against the pre-change
      artifact.
- [x] `prompts/intent/split.md` frontmatter `revision` is greater than the pre-change value when the
      body changes.

## Documentation updates

- None in this subspec — operator docs land in [01](./01-intent-split-surface-docs.md).
