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
- Wired implement-review templates only (`patch.prompt.review.{critic,adversary,advocate,adjudicator}`): describe unified diff input and drop "not a unified diff" prose; bump affected step revisions; rules out critic-only or debate-only partial rollout.
- Unwired legacy `patch.prompt.review` (`prompts/patch/review.md`) is exempt — already describes a unified diff and has no consumer; rules out pointless revision churn on an unwired artifact.
- Baseline regression asserts rendered `BRANCH_DIFF` includes unified-diff markers (`diff --git`, `@@`) and fails against today's stat/name-only `branchDiff` helper; rules out shipping unified diff without a failing-test contract.
- Critic and all three debate roles render through the same `branchDiff` helper; rules out per-role diff assembly.
- Scope is v2 implement review via `shared/prompts/review-implement.ts`; rules out retargeting v1 `getBranchDiffSummary` in this slice.
- Plan and intent review prompts are unchanged; rules out markdown-first review flows that already supply full artifacts.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement review `BRANCH_DIFF` carries unified diff plus orientation.
- `v2/docs/v1-behaviors.md` — record changed implement review input (replaces summary-only bullets).

## Prerequisites
