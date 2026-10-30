# The PR narrative describes the branch

- [ ] [00 - Shrink narrative branch-against-base scope](./00-shrink-narrative-branch-scope.md)

## Decisions

- `.scratch/shrink-narrative.md` summarizes the whole branch against its merge-base anchor (what the PR changes, why, how to verify), using `<<<BRANCH_SUMMARY_BEGIN>>>` / `BRANCH_DIFF` as orientation; rules out treating the shrink pass's simplification diff as the narrative subject.
- The narrative body must not lead with or center shrink-only cleanup; shrink-pass commentary may appear only as at most one trailing line after the branch summary; rules out PR bodies that describe alias removal while omitting feature work (PR #4567 class).
- Bump `implement.prompt.shrink` `revision` only for the narrative instruction change; narrative file capture (`tryReadShrinkNarrative`), marker rendering (`refreshPrBody`), and publication threading stay code-unchanged; rules out wiring changes disguised as prompt edits.
- Placeholder generation stays unchanged: `BRANCH_DIFF` remains `git diff --stat` at the shrink anchor, `RUN_SCOPED_DIFF` the allowlisted unified diff at the same anchor; rules out a shrink-only diff placeholder for narrative scope.
