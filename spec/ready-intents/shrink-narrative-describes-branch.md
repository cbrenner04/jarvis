---
name: shrink-narrative-describes-branch
risk: low
effort: low
---
# The PR narrative describes the branch

Unsplit rationale: One prompt behavior changes; its regression test and documentation fit the same reviewable intent.

## Primary implementation surface

- Shrink narrative instructions in `prompts/implement/shrink.md` (`implement.prompt.shrink`).

## Prerequisites

## Problem

The shrink prompt asks for “what changed” without defining the comparison, so agents describe their cleanup instead of the branch's features. PR #4567 described removing an alias added during implementation while omitting lane-PR adoption and severed-lane revival.

## Decisions

- Define `.scratch/shrink-narrative.md` as a summary of the whole branch against its base: what the PR changes, why, and how to verify. Use `BRANCH_DIFF` as branch scope context.
- Explicitly distinguish branch changes from the shrink pass's own edits. Shrink-pass edits may appear only in the narrative's final line (at most one trailing line after the branch summary); the body must not lead with or center shrink-only cleanup.
- Bump the shrink prompt's `revision`. Keep narrative capture, marker rendering, and publication unchanged.
- Keep placeholder generation unchanged: `BRANCH_DIFF` is a branch stat summary; `RUN_SCOPED_DIFF` is the allowlisted unified diff against the same anchor, not a diff of shrink-only edits.

## Verification

- Add a regression test in `src/execution/write-prompt.test.ts` asserting the assembled shrink prompt requires branch-against-base narrative scope, excludes shrink-only narration as the main summary, and requires shrink commentary at most one final line; it fails against the pre-fix prompt.
- Plan subspec preservation ACs for narrative capture, marker rendering, publication, and placeholder generation must cite existing tests (e.g. `write-prompt.test.ts`, pr-body-refresh / publication tests), not paraphrase "unchanged."

## Documentation updates

- `docs/write-behavior.md`: define the authored narrative's branch-against-base scope at the narrative block contract.
- `docs/prompts.md`: record the shrink prompt's narrative scope and link to the narrative contract.
- `docs/v1-behaviors.md`: align the existing implement-publication narrative entry with the scope change.
- `docs/workflow-runner.md` (`## PR body narrative markers`, shrink narrative paragraph): align branch-against-base scope with `docs/write-behavior.md` or reduce to a cross-link without restating conflicting generic "what changed" scope.
