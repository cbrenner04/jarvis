---
name: implement-review-supplies-unified-diff
---

# Implement review supplies unified branch diff

Implement review roles (`critic`, `adversary`, `advocate`, `adjudicator`) receive
`BRANCH_DIFF` as stat/path orientation plus the merge-base unified diff. Today
`shared/prompts/review-implement.ts` emits only `--stat` and `--name-only`.

## Decisions

- `branchDiff` prepends stat and changed-path orientation, then the unified diff from `git merge-base <base> HEAD` and `git diff <mergeBase> HEAD`; rules out stat-only substitution or dropping orientation.
- Placeholder name stays `BRANCH_DIFF`; rules out a new placeholder that forks review templates.
- Template prose updates are critic-only (`patch.prompt.review.critic`, v2-only consumer): section heading/prose describe merge-base unified diff input; remove "not a unified diff" and summary-only wording; bump critic revision only. Debate templates (`patch.prompt.review.{adversary,advocate,adjudicator}`) remain summary-worded until v1 `getBranchDiffSummary` changes — v2 implement debate renders carry unified diff under that prose temporarily; rules out debate revision bumps or prose that contradicts v1 summary payloads.
- Unwired legacy `patch.prompt.review` (`prompts/patch/review.md`) is exempt — already describes a unified diff and has no consumer; rules out pointless revision churn on an unwired artifact.
- Baseline regression asserts rendered `BRANCH_DIFF` includes unified-diff markers (`diff --git`, `@@`) and fails against today's stat/name-only `branchDiff` helper; rules out shipping unified diff without a failing-test contract.
- Critic and all three debate roles render through the same `branchDiff` helper; rules out per-role diff assembly.
- Scope is v2 implement review via `shared/prompts/review-implement.ts`; rules out retargeting v1 `getBranchDiffSummary` in this slice.
- Plan and intent review prompts are unchanged; rules out markdown-first review flows that already supply full artifacts.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement review `BRANCH_DIFF` carries unified diff plus orientation.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** implement review `BRANCH_DIFF` input (unified diff plus orientation), with sibling note qualifying divergence from line 605; do not replace v1 patch-review summary-only bullets at lines 106/109.

## Prerequisites

- Merge-first sibling `implement-review-bounds-diff-payload` after this slice (same `branchDiff` seam; do not plan or run in parallel).
