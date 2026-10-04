# 00 — Cleanup delegates GitHub PR operations

## Problem

`cleanup.ts` calls `runner.runAsync("gh", …)` for merged checks, head-authority listing, successor state, comment bodies, plan-subsumed gates, open-PR listing, archive-publication `gh` callbacks, and abandon-time PR closure, duplicating `github-operations.ts` and blocking structured mocks.

## Decisions

- All `gh` usage in `cleanup.ts` routes through `v2/src/execution/github-operations.ts` exports with the injected `AsyncSubprocessRunner` — rules out a parallel cleanup-local `gh` argv builder or reading `gh` from ambient PATH outside the runner seam.
- Soft probes (`isMerged`, `ghPrHeadRecordsForBranch`, `listGhPrCommentBodies`, `ghSuccessorPrMergedInRepo`, `planSubsumedPrGateAllows`) keep today's fail-soft semantics: catch `GitHubOperationError` (and transport failures) and return `{ merged: false, reason }`, `undefined`, or `false` instead of throwing — rules out turning eligibility gates into hard errors when `gh` is down (reachable today via `OPEN_PR_PROBE_UNREACHABLE_REASON`, `planSubsumedPrGateAllows` catch → false, and silent merged skips).
- `isMerged` stays merged only when boundary data has `state === "MERGED"` and truthy `mergedAt` (today's `gh pr view` JSON gate) — rules out treating `MERGED` without `mergedAt` or other states as merged.
- `ghSuccessorPrMergedInRepo` returns `false` when `isCrossRepository === true` before merged-state checks — rules out counting cross-repo successor PRs as merged for supersede settlement.
- `listOpenPrsForBranch` keeps hard throw on `gh` failure or malformed list JSON (reachable today ~`listOpenPrsForBranch`); delegate via `listPrs` (or equivalent boundary list) without softening callers.
- `applyEndArchivePublication` replaces the local `gh` async callback with boundary calls wired into `publishArchiveReady`'s injectable seam; push-step vs PR-step failure discrimination unchanged — rules out leaving `runAsync("gh"` in that function after migration.
- Hard abandon step `PR closure` propagates `GitHubOperationError` into the existing `AbandonOutcome` stderr shape — rules out swallowing close failures.
- Cleanup does not add GitHub retry loops; retryability is documented via `GitHubOperationError.retryable` only in operator text where errors surface — rules out new transient-retry policy in cleanup beyond pre-migration single-attempt calls.
- Extend `viewPrState` to accept the same `PrSelector` as `viewPr` when branch-shaped `isMerged` needs it — rules out leaving `isMerged` on a raw `gh pr view <branch>` spawn after migration (reachable on main in `isMerged` today).
- `listPrs` supplies `headRefOid` and `state` for `mergedPrHeadAuthorityMatches`; use it instead of a bespoke list JSON shape — rules out a second list field set in cleanup.

## Task checklist

- Replace `isMerged`, `ghPrHeadRecordsForBranch`, `listGhPrCommentBodies`, `ghSuccessorPrMergedInRepo`, `planSubsumedPrGateAllows`, and `listOpenPrsForBranch` internals with `viewPrState`, `listPrs`, `viewPrReviewActivity`, and related boundary calls.
- Replace `applyEndArchivePublication`'s `gh` callback with boundary-backed calls; keep `publishArchiveReady` seam.
- Replace abandon `gh pr close` with `closePr`.
- Extend `viewPrState` for `PrSelector` when needed; add `github-operations.test.ts` coverage for branch-shaped selectors.
- Add or adjust `cleanup.test.ts` mocks to assert boundary delegation (inject runner that records operation shapes, not argv strings scattered across cleanup).

## Acceptance criteria

- [x] `github-operations.test.ts` adds `viewPrState accepts branch PrSelector` asserting branch-shaped `viewPrState` issues `gh pr view` with the branch selector; fails against pre-fix `viewPrState` limited to numeric PR numbers (~`github-operations.ts` `viewPrState`).
- [x] `cleanup.test.ts` adds `isMerged requires MERGED state and mergedAt` asserting a boundary `viewPrState` response with `state !== "MERGED"` or absent `mergedAt` yields `merged: false`; fails if delegation treats `MERGED` without `mergedAt` as merged.
- [x] `cleanup.test.ts` adds `ghSuccessorPrMergedInRepo rejects cross-repository successor` asserting `isCrossRepository: true` yields `false` even when state is `MERGED` with `mergedAt`; fails if cross-repo guard is dropped.
- [x] `cleanup.test.ts` adds `planSubsumedPrGateAllows delegates listPrs for head state` asserting `listPrs` with head filter and no `runAsync("gh"` inside `planSubsumedPrGateAllows`; fails against pre-fix inline `gh pr list` (~line 633).
- [x] `cleanup.test.ts` adds `listOpenPrsForBranch delegates listPrs` asserting open head listing uses the boundary with `{ state: "open" }` (or equivalent) and no inline `runAsync("gh"` in `listOpenPrsForBranch`; fails against pre-fix spawn (~line 1262).
- [x] `cleanup.test.ts` test `runCleanupCommand confirms and removes eligible worktree via git worktree remove + prune + branch -D` stays green after mocks move to boundary-shaped `gh` responses (behavior unchanged).
- [x] `cleanup.test.ts` adds `mergedPrHeadAuthorityMatches delegates listPrs for head authority` asserting `listPrs` with `{ branch, state: "all" }` and no `runAsync("gh"` in `mergedPrHeadAuthorityMatches`; fails against pre-fix inline `gh pr list` in `ghPrHeadRecordsForBranch`.
- [x] `cleanup.ts` contains no `runAsync("gh"` in GitHub helpers owned by this subspec (`isMerged`, `ghPrHeadRecordsForBranch`, `listGhPrCommentBodies`, `ghSuccessorPrMergedInRepo`, `planSubsumedPrGateAllows`, `listOpenPrsForBranch`, `applyEndArchivePublication`, abandon close) — staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
