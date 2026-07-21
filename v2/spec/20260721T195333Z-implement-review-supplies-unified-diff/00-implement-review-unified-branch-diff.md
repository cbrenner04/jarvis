# Implement review unified branch diff

v2 implement review (`critic`, `adversary`, `advocate`, `adjudicator`) renders
`BRANCH_DIFF` from `shared/prompts/review-implement.ts`. Today the helper emits
only `git diff --stat` and `--name-only`. Reviewers need merge-base unified diff
content with stat/path orientation preserved.

## Decisions

- `branchDiff` emits the stat block, a `Changed paths:` listing (repo-relative
  paths sorted by byte/codepoint lexicographic order, matching v1
  `getBranchDiffSummary`), then merge-base unified diff from
  `git merge-base <base> HEAD` and `git diff <mergeBase> HEAD`; rules out
  stat-only substitution or dropping orientation.
- Placeholder name stays `BRANCH_DIFF`; rules out a sibling placeholder that
  forks review templates.
- Critic and all three debate roles render through the same `branchDiff` helper;
  rules out per-role diff assembly.
- Template prose updates are critic-only (`patch.prompt.review.critic`, v2-only
  consumer): section heading/prose describe merge-base unified diff input; remove
  "not a unified diff" and summary-only wording; bump critic revision only.
  Debate templates (`patch.prompt.review.{adversary,advocate,adjudicator}`)
  remain summary-worded until v1 `getBranchDiffSummary` changes — v2 implement
  debate renders carry unified diff under that prose temporarily; rules out
  debate revision bumps or prose that contradicts v1 summary payloads.
- Unwired `patch.prompt.review` (`prompts/patch/review.md`) is exempt; rules out
  revision churn on a consumer-less artifact.
- Scope is v2 implement review via `review-implement.ts` only; rules out changing
  v1 `getBranchDiffSummary` or its call sites in this slice.
- Plan and intent review prompt rendering is unchanged; rules out markdown-first
  review flows that already supply full artifacts.

## Prerequisites

- Merge-first sibling `implement-review-bounds-diff-payload` after this slice (same
  `branchDiff` seam; do not plan or run in parallel).

## Tasks

- Extend `branchDiff` in `shared/prompts/review-implement.ts` (path sort matches
  v1 `getBranchDiffSummary`).
- Add `shared/prompts/review-implement.test.ts` with a real-git fixture covering
  critic and debate role renders, including a non-`main` `baseBranch`.
- Update `prompts/patch/review-critic.md` prose and bump revision only.
- Update `v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md` per
  documentation updates below.

## Acceptance criteria

- [ ] Rendered implement-review critic prompt `BRANCH_DIFF` includes stat/`Changed paths:` orientation and unified-diff hunk markers (`diff --git`, `@@`); `shared/prompts/review-implement.test.ts` fails against the pre-fix stat/name-only helper and passes after.
- [ ] `shared/prompts/review-implement.test.ts` asserts rendered `BRANCH_DIFF` for critic and all three debate roles against a non-`main` `baseBranch` (merge-base resolution via `ReviewDebateRenderContext.baseBranch`).
- [ ] Rendered implement-review adversary, advocate, and adjudicator prompts carry the same unified `BRANCH_DIFF` payload via the shared helper (`shared/prompts/review-implement.test.ts`).
- [ ] `patch.prompt.review.critic` describes merge-base unified diff input without "not a unified diff" prose; critic revision is bumped; `patch.prompt.review.{adversary,advocate,adjudicator}` revisions and summary-worded section prose are unchanged; `patch.prompt.review` (`prompts/patch/review.md`) revision is unchanged.
- [ ] `v1/test/modes/patch/review.test.ts` stays green (v1 `getBranchDiffSummary` path unchanged).
- [ ] `v2/docs/workflow-runner.md` documents implement review `BRANCH_DIFF` as stat/path orientation plus merge-base unified diff and cites `shared/prompts/review-implement.ts` (not `review-debate-render.ts`) as the implement-review render source.
- [ ] `v2/docs/v1-behaviors.md` records v2 implement review `BRANCH_DIFF` carrying unified diff via an additive **[v2 additive]** bullet with a sibling note that implement-review payload semantics diverge from the v2 async parity bullet at line 605 (patch-review branch-diff rendering remains stat + name-only); v1 patch-review summary bullets at lines 106/109 are unchanged.

## Documentation updates

- `v2/docs/workflow-runner.md` — patch review prompt rendering: implement review
  `BRANCH_DIFF` carries stat/path orientation plus merge-base unified diff;
  correct stale source path to `shared/prompts/review-implement.ts`.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** implement review `BRANCH_DIFF`
  input (unified diff plus orientation), with sibling note qualifying divergence
  from line 605; do not replace v1 patch-review summary-only bullets.
