# The PR narrative describes the branch

- [x] [00 - Shrink narrative branch-against-base scope](./00-shrink-narrative-branch-scope.md)

## Decisions

- `.scratch/shrink-narrative.md` summarizes the whole branch against its merge-base anchor (what the PR changes, why, how to verify), using `<<<BRANCH_SUMMARY_BEGIN>>>` / `BRANCH_DIFF` as scope context; rules out treating shrink-pass simplification or `<<<DIFF_BEGIN>>>` / `RUN_SCOPED_DIFF` as the narrative subject.
- The narrative body must not lead with or center shrink-only cleanup; shrink-pass commentary may appear only as at most one trailing line after the branch summary; rules out PR marker bodies that describe alias removal while omitting feature work (PR #4567 class).
- Bump `implement.prompt.shrink` `revision` for the `## Narrative` instruction change only; `tryReadShrinkNarrative`, `refreshPrBody`, and completion publication wiring stay code-unchanged; rules out runner or publisher edits disguised as prompt work.
- Shrink placeholder generation stays unchanged: `BRANCH_DIFF` remains stat summary at the shrink anchor, `RUN_SCOPED_DIFF` the allowlisted unified diff at the same anchor; rules out a shrink-only diff placeholder or anchor change for narrative scope.
