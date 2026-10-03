# 06 — Cleanup operation errors and operator docs

## Problem

After delegation, cleanup stderr should name the failing typed git/GitHub operation and whether the failure is retryable, without inventing new retry policy.

## Decisions

- Retirement and abandon hard failures include `GitOperationError` / `GitHubOperationError` operation id and `reason` in stderr (via existing `message` or a thin formatter), preserving prior one-attempt behavior — rules out new automatic retries in cleanup when `retryable` is true.
- Soft eligibility paths keep soft outcomes; they may mention `gh` unreachable using existing constant text — rules out promoting sandbox `gh` failures to thrown errors in default cleanup.
- No behavior change to exit codes or abandon step ordering — rules out reclassifying partial abandon teardown as success.
- `v1-behaviors.md` records only observable cleanup error-message or retry-text changes; if delegation is wording-only with identical branches, note "no operator behavior change" — rules out fictional retry policy bullets.

## Task checklist

- Add a small formatter or consistent `errorMessage` usage for operation errors on hard paths (`retireMergedWorktrees`, `performAbandonmentSteps`, archive publication catch).
- Update `v2/docs/operator-runbook.md` Cleanup section: failures cite git/GitHub operation names and retryability per boundary docs.
- Update `v2/docs/v1-behaviors.md` cleanup bullets when message text changes.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `removal guards are load-bearing: git worktree remove is essential` asserts stderr includes a `git worktree-remove` (or equivalent `GitOperationError`) fragment after migration; fails against pre-fix generic `git worktree remove failed` text when the assertion is added.
- [ ] `cleanup.ts` has zero `runAsync("git"` and zero `runAsync("gh"` occurrences — invariant for this intent (reachable on main: 34+ inline `git` and multiple `gh` spawns per `grep`, including tick-backing `git log -p` ~line 3502 and archive `git`/`gh` callbacks ~line 1543).
- [ ] `v2/docs/operator-runbook.md` documents cleanup failure messages referencing typed git/GitHub operations and retryability.
- [ ] `v2/docs/v1-behaviors.md` updated for any cleanup error or retry wording change, or explicitly states no behavior change if messages are equivalent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — cleanup error messages reference the failing operation and boundary retryability semantics.
- `v2/docs/v1-behaviors.md` — cleanup behavior catalog aligned with any message or retry-text change.
