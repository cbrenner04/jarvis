# Implement publication preserves per-turn commits

## Problem

Git-enabled implement workflows sample `headBeforeImplementStep`, commit a pre-shrink consolidation boundary, then `git reset --mixed` to that anchor before the workflow-completion publication tail. Per-iteration `commitSettledIteration` SHAs become unreachable from the branch ref; one terminal `forceDistinctCommit` commit off the pre-implement parent survives. This regresses v1's one-commit-per-subspec history.

## Surface

`v2/src/execution/workflow-runner.ts` (pre-implement anchor, pre-shrink consolidation, workflow-completion publication tail, intent-resume publication, recovered-plan landing, review-mutation resume), `v2/src/execution/write-loop.ts` (write-completion publication tail when `publishCompletion` is true), `v2/src/execution/completion-commit.ts` (terminal commit only when the boundary introduces changes), and co-located tests. Per-turn implement commit subjects are owned by [01 - Write turns use distinct per-turn commit subjects](./01-plan-intent-distinct-commit-subjects.md); attribution test contract is owned by [03 - Publication Commits block and footer list every per-turn agent](./03-publication-commits-list-all-agents.md).

## Decision ledger

- Remove `preImplementResetAnchor` sampling and the publication-tail `git reset --mixed` to it; rules out rewinding HEAD to pre-implement before the final commit.
- Drop the pre-shrink consolidation commit whose only purpose was enabling that reset; rules out a terminal write-boundary commit that exists solely to collapse iteration history.
- Terminal boundaries (`write` completion, `~shrink`, `review`/`review-debate` publication tail, intent-resume, recovered-plan landing, review-mutation resume) append a commit only when the boundary introduces file changes not already on `HEAD`; rules out `forceDistinctCommit` marker commits over an already-settled tree.
- Per-iteration `commitSettledIteration` SHAs remain ancestors of the published branch tip through shrink and review; rules out restaging the full worktree into one replacement commit at any terminal boundary.
- Retire `publishedCommitAgent` trailer substitution on every publication tail listed in Surface; rules out carrying the write-stage `Jarvis-Agent` onto a single surviving review-classified commit.
- Shrink iterations that change files commit through the existing write-loop checkpoint path with `Jarvis-Step: shrink`; rules out deferring shrink step labeling while intent lists `shrink` in step vocabulary.
- Ready-gate repair commits remain when files genuinely change; revert-to-base and empty-marker rollback stay no-op; landing commits that delete staging dirs with an unchanged tree produce no commit; `suppressShrink` implement steps still accumulate per-iteration commits.
- Empty-publication (no diff vs base at push time) suppresses push and PR creation only; iteration SHAs already on the branch remain reachable and count toward attribution inputs; rules out treating empty-publication as deleting iteration commits.

## Task checklist

- Remove `preImplementResetAnchor` and the publication-tail mixed reset; stop creating the pre-shrink consolidation commit used only for that collapse.
- Change every publication tail in Surface so terminal commits skip when `HEAD` already captures the boundary's file changes (keep ready-gate repair commits that genuinely change files).
- Remove `publishedCommitAgent` usage from all terminal publication commit inputs in Surface; each commit keeps the agent that produced that turn's edits.
- Label shrink checkpoint commits `Jarvis-Step: shrink` when shrink edits change files.
- Add a `workflow-runner-publication.test.ts` regression that drives a multi-subspec implement workflow with single-pass light review through publication and asserts ≥ N+1 commits ahead of base for N completed subspec write turns plus one mutating review commit, each with matching `Jarvis-Agent`/`Jarvis-Step` and subjects per subspec 01.
- Add a `workflow-runner-publication.test.ts` regression that records commit count across implement write completion, `~shrink`, and review publication boundaries and asserts the count never decreases.
- Invert or replace superseded `publishedCommitAgent` regressions in `completion-commit.test.ts` (`publishedCommitAgent` carry-forward helper tests) per subspec 03; leave `workflow-runner-publication.test.ts` attribution assertions to subspec 03 (`write-stage-attribution-footer`, `single-agent-attribution-footer`, `no-content-ahead-of-base` empty-marker rollback).

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` test `implement publication retains one commit per subspec write turn plus one mutating review commit` fails against the current pre-implement reset collapse and passes after the fix.
- [ ] `workflow-runner-publication.test.ts` test `branch commit count never decreases across implement write, shrink, and review boundaries` fails when a terminal boundary CAS-replaces or removes a prior commit and passes after the fix.
- [ ] `completion-commit.test.ts` regressions that assert `publishedCommitAgent` carry-forward on terminal publication commits fail against the pre-fix substitution and pass after inversion or removal per subspec 03.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

Deferred to [04 - Document per-turn publication commit history](./04-publication-commit-history-docs.md).
