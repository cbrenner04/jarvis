# Surface split rule in intent prompt

## Problem

`prompts/intent/split.md` tells the split step to fan out by independently observable
behavior (symptom slices). Cross-boundary fixes therefore land as one ready-intent and one
plan/implement run.

## Decisions

- Split enumerates module-boundary surfaces the fix must change and emits one ready-intent per
  surface in dependency order — rules out one-intent-per-symptom and numeric file-count budgets.
- Genuinely single-surface seeds emit one ready-intent and state in one line why splitting does
  not apply — rules out forced fragmentation.
- The surface rule is one added prompt sentence with no examples or thresholds — rules out prompt
  bloat from case lists.
- Multi-surface splits wire earlier-surface behaviors into later intents' `## Prerequisites`
  bullets in dependency order — rules out intent-name references or implicit ordering with no
  prerequisite text.
- Pin the surface rule via a stable substring constant in `shared/prompts/intent-split.test.ts` —
  rules out paraphrase-only assertions that drift from the artifact.
- Introduce the split-prompt growth budget in this subspec: constant max delta over the pre-change
  `prompts/intent/split.md` artifact body length — rules out assuming a pre-existing budget test
  (intent names it; none is committed yet).
- Bump `revision` in `prompts/intent/split.md` frontmatter — rules out a silent prompt change
  without governance-visible revision.

## Task checklist

- [ ] Add one sentence to `prompts/intent/split.md` for the surface rule; align output rules for
      dependency-ordered surfaces, cross-surface prerequisite behaviors, and single-surface unsplit
      rationale without examples or numeric thresholds.
- [ ] Retain the spec-guidance reviewability reference; do not hardcode line counts.
- [ ] Add `shared/prompts/intent-split.test.ts` coverage: pinned surface-rule substring,
      artifact-body growth budget, and absence of examples/threshold patterns in the artifact body.
- [ ] Export or colocate the pin constant so the inversion AC can negate it in-test.

## Acceptance criteria

- [ ] `shared/prompts/intent-split.test.ts` test `intent split prompt pins surface fan-out rule`
      asserts `buildIntentSplitPrompt` output contains the pinned substring and requires
      dependency-ordered surfaces, earlier-surface behaviors in later `## Prerequisites` bullets,
      and a one-line unsplit rationale for single-surface seeds; it fails against the pre-change
      prompt.
- [ ] `shared/prompts/intent-split.test.ts` test `intent split artifact growth stays within budget`
      asserts the registry artifact body for `intent.prompt.split` is at most the pre-change body
      length plus the subspec's max-delta constant; it fails when the surface rule exceeds that
      budget.
- [ ] `shared/prompts/intent-split.test.ts` asserts `prompts/intent/split.md` artifact body
      contains no example blocks and no numeric split thresholds (symptom counts, file counts, line
      budgets).
- [ ] Inverting the pinned surface-rule substring in `intent split prompt pins surface fan-out
      rule` turns that test RED.

## Documentation updates

- None in this subspec — operator docs land in [01](./01-intent-split-surface-docs.md).
