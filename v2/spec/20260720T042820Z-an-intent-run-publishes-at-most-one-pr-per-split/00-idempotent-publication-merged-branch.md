# Publication is idempotent against a merged split branch

## Problem

One `jarvis run workflow intent` invocation opened two PRs for the same split
(#1689, #1692) adding the identical ready-intent file. The first landed; its
`intent/<slug>` branch was deleted on merge. A second publication then fired,
`external-worktree.ts` re-created the deleted branch from base, and the guard
opened a duplicate PR.

Root cause of the duplicate is the PR-creation guard. `findOrCreatePr`
(`completion-publisher.ts:152`) lists PRs with `--state open` only. A merged
split PR is `closed`, so it is invisible to the guard; the guard sees no open PR
for the (re-created) branch and runs `gh pr create` a second time. Nothing
consults the already-landed/merged state of the split before creating a PR.

## Decisions

- Guard on the split branch's merged state, not just open PRs — a merged PR for `intent/<slug>` means the split already published, so publication short-circuits as an idempotent success instead of creating a second PR. Rules out the current `--state open`-only check that re-publishes after merge.
- The merged-PR check keys on the split's output branch (`intent/<slug>`), the same head `findOrCreatePr` already lists on — not on file content or run id. Rules out a content-diff or ownership-ledger check at PR time, which would still race the deleted-then-recreated branch.
- Scope to merged PRs; a still-open PR keeps the existing reuse path (retry targets the same open PR). Rules out also short-circuiting on closed-unmerged PRs, which an operator may have closed intending a re-publish.

## Task checklist

- [ ] Extend the `findOrCreatePr` guard in `completion-publisher.ts` to detect a merged PR for the split branch before `gh pr create` and return it as an idempotent no-op (no second PR).
- [ ] Add the failing test in `completion-publisher.test.ts`.
- [ ] Update `v2/docs/workflow-runner.md` publication section.

## Acceptance criteria

- [ ] `completion-publisher.test.ts` gains a case where the split branch's only PR is merged (PR list returns a merged PR and no open PR); it asserts `gh pr create` is never invoked and publication resolves to that merged PR as an idempotent success. It fails against the pre-fix code and passes after.
- [ ] When a split's branch already has a merged PR, a re-fired publication in the same run opens no second `intent/<slug>` PR — it reports the prior merged publication instead.
- [ ] `completion-publisher.test.ts:682` ("reuses existing PR ... without creating a second PR") stays green — a legitimate re-publish against a still-open PR still targets that same open PR (behavior unchanged).
- [ ] `v2/docs/workflow-runner.md` documents that publication is idempotent against a merged/deleted split branch: a merged split is not re-published.

## Documentation updates

- `v2/docs/workflow-runner.md`: note in the publication section that `findOrCreatePr` treats a merged PR on the split branch as already-published and does not create a duplicate.
