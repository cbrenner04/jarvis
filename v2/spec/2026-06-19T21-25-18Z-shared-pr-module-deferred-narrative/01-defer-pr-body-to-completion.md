# Defer patch PR body rewrite to completion pipeline

## Problem

Patch mode rewrites the PR body (`updatePrBody` → `gh pr edit`) after every successful subspec commit (`v1/src/modes/patch/run.ts`, in the subspec-complete branch). With many subspecs this fires `gh pr edit` repeatedly mid-run, each time re-fetching and reassembling the body, even though only the final body is meaningful for review.

## Behavior

Patch mode rewrites the PR body once, in the completion pipeline, before shrink/review run (i.e. after the green completion ready gate, alongside the existing once-at-completion phases). The first subspec completion still calls `ensureDraftPr` so the draft PR exists early; it no longer triggers a per-subspec `updatePrBody`. Intermediate subspec completions create no `gh pr edit`.

On warn-and-continue failure of the completion-time rewrite, the run proceeds (matching the current warn-and-continue posture); readiness still flips via the existing completion-pipeline path.

## Decisions

- PR body rewrite moves to the completion pipeline, fired once before shrink/review. Rules out the per-subspec-complete rewrite cadence.
- First subspec completion still ensures the draft PR exists. Rules out deferring PR creation to the terminal subspec.
- Plan-mode PR-body update timing is unchanged. Rules out reworking plan's draft/review-driven refresh, which is not per-subspec.

## Task checklist

- [ ] Remove the per-subspec-complete `updatePrBody` call from the patch subspec-complete path; keep `ensureDraftPr` on first completion.
- [ ] Add a single PR-body rewrite in the completion pipeline before shrink/review.
- [ ] Update docs.

## Acceptance criteria

- [ ] A multi-subspec patch run rewrites the PR body (`gh pr edit`) exactly once, at the completion transition before shrink/review, not on each intermediate subspec completion.
- [ ] The first subspec completion still creates the draft PR before the completion transition.
- [ ] A failure of the completion-time PR-body rewrite is warned and does not abort the run; the PR still transitions toward ready via the existing completion path.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: replace the "rewritten after every successful subspec commit" cadence with "draft created on first subspec completion; body rewritten once at the completion transition before shrink/review."
- `v2/docs/v1-behaviors.md`: update the patch PR-body rewrite-cadence entries to the once-at-completion timing.
