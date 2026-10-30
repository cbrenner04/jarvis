# 00 - Shrink narrative branch-against-base scope

## Problem

The shrink prompt's `## Narrative` asks for a review-altitude summary of "what changed" without naming the comparison anchor, so agents narrate shrink-pass cleanup instead of branch features. PR #4567 described removing an implementation alias while omitting lane-PR adoption and severed-lane revival.

## Decisions

- Rewrite `prompts/implement/shrink.md` `## Narrative` so `.scratch/shrink-narrative.md` is explicitly branch-against-base (whole PR), with `BRANCH_DIFF` / `<<<BRANCH_SUMMARY_BEGIN>>>` as orientation; rules out undifferentiated "what changed" scoped to the shrink iteration.
- Require shrink-only commentary at most one final line after the branch summary; the body must not lead with or center shrink cleanup; rules out narratives whose primary subject is simplification edits visible only in `<<<DIFF_BEGIN>>>`.
- Increment shrink frontmatter `revision` (currently `6` on main); no edits to `shrinkPromptPlaceholders`, `tryReadShrinkNarrative`, or publication callers.

## Task checklist

- [ ] Update `## Narrative` in `prompts/implement/shrink.md` and bump `revision`.
- [ ] Add a regression test in `src/execution/write-prompt.test.ts` on rendered `implement.prompt.shrink` asserting branch-against-base narrative scope, shrink-only narration excluded as the main summary body, and shrink commentary capped at one trailing line.
- [ ] Align `docs/write-behavior.md`, `docs/prompts.md`, `docs/v1-behaviors.md`, and `docs/workflow-runner.md` per Documentation updates.

## Acceptance criteria

- [ ] `write-prompt.test.ts` includes a regression test that renders `implement.prompt.shrink` and asserts branch-against-base narrative scope, that shrink-only narration is not prescribed as the main summary body, and that shrink commentary is capped at one trailing line; it fails against the pre-fix prompt (reachable on main: current `## Narrative` says "what changed" without branch anchor or shrink/body split).
- [ ] `workflow-runner-validation.test.ts` `implement workflow publication receives shrink-authored narrative when present` stays green (narrative capture unchanged).
- [ ] `pr-body-refresh.test.ts` `emits supplied narrative in marker block when fetched body has no narrative` stays green (marker rendering unchanged).
- [ ] `workflow-runner-shrink-placeholders.test.ts` stays green (placeholder generation unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes.

## Documentation updates

- `docs/write-behavior.md`: at the PR body narrative / marker contract, define shrink-authored narrative text as branch-against-base scope (what the PR changes, why, verify), with shrink-pass notes at most one trailing line; align with shrink prompt wording.
- `docs/prompts.md`: under `implement.prompt.shrink`, record branch-against-base narrative scope and link to the narrative contract in `docs/write-behavior.md`.
- `docs/v1-behaviors.md`: update the `[harness implement publication change]` narrative bullet so "what changed" means branch-against-base, not shrink cleanup alone.
- `docs/workflow-runner.md` (`## PR body narrative markers`, shrink narrative paragraph): align branch-against-base scope with `docs/write-behavior.md` or cross-link without restating conflicting generic "what changed" scope.
