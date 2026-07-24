# Dirty-worktree refusal on stale reset

## Problem

`resetStaleWorkspace` (`v2/src/commands/cleanup.ts`) runs on incomplete git-enabled
`jarvis run workflow implement` or `plan` re-runs (`maybeResetStaleWorkspace` in
`v2/src/commands/workflow.ts`) after live-held and open-PR gates, then calls
`performAbandonmentSteps`. It never inspects the managed worktree for local edits;
re-running after a blocked or failed run can destroy uncommitted tracked or untracked
work silently.

## Decisions

- Refuse implicit reset when the materialized worktree is dirty per the detection policy below; `reason` names dirty paths and recovery. Rules out calling `performAbandonmentSteps` on a dirty tree.
- **Observability:** `resetStaleWorkspace` refuses with `{ status: "refused", reason }` only (same as live-held and open-PR gates); it does not write stderr. `maybeResetStaleWorkspace` surfaces operator stderr as `Error: Cannot re-run incomplete spec: ${reason}`. Rules out stderr assertions on the cleanup seam or stderr writes inside `resetStaleWorkspace`.
- `reason` uses a stable, scannable lead-in (parallel to other pre-mutation refusals), then dirty paths and recovery: commit, discard local changes, or `jarvis cleanup --abandon <branch>`. Rules out a path-only dump with no recovery guidance.
- Dirty refusal is pre-mutation: no worktree removal, branch deletion, or PR close. Rules out partial teardown before the dirty check.
- Gate order stays live-held → open PR → dirty worktree → abandonment. Rules out folding dirty state into the existing gates or running abandonment first.
- **Dirty detection (safety gate):** list dirty paths with `git status --porcelain --untracked-files=all` in the managed worktree (align with harness gates such as `review-intent-enforcement.ts`). **Dirty** = any porcelain line for uncommitted tracked changes or untracked paths (including under directories). Ignored-only untracked follows default porcelain semantics. Submodule or conflict lines count as dirty (non-empty porcelain). If listing fails or is unusable, refuse fail-closed with a clear `reason` and do not call `performAbandonmentSteps`; do not use fail-soft helpers that return empty and continue.
- Implement the gate only in `resetStaleWorkspace` (shared by implement and plan via `maybeResetStaleWorkspace`). Rules out duplicate checks per workflow name.
- One workflow-level regression covers the operator path; direct `resetStaleWorkspace` tests cover the seam without per-workflow AC duplication. Rules out separate implement and plan workflow ACs for the same guard.
- No auto-stash or auto-commit of agent leftovers. Rules out silent preservation of unreviewed output.
- `jarvis cleanup --abandon` keeps today’s behavior (no dirty gate on that entry). Rules out coupling the abandon escape hatch to implicit re-run reset in this slice.
- Guard-inversion coverage targets an extracted dirty-check seam (or equivalent unit test hook), not only end-to-end refusal tests. Rules out a no-op guard that passes refusal tests alone.

## Task checklist

- [ ] After `gateOnOpenPrs` and before `performAbandonmentSteps`, detect dirty state per the detection policy; extract listing into a testable seam when needed for inversion coverage.
- [ ] Return `{ status: "refused", reason: … }` with lead-in, dirty paths, and recovery options; perform no retirement mutations; no stderr on this path.
- [ ] Add `cleanup.test.ts` coverage on `resetStaleWorkspace` for dirty tracked and dirty untracked cases (worktree, branch, and PR survive; assert `reason` names paths and recovery).
- [ ] Add one `workflow.test.ts` regression driving incomplete git-enabled `run workflow implement` re-run against a dirty managed worktree (exit `1`, stderr contains `Cannot re-run incomplete spec:` with dirty paths and recovery, no teardown side effects).
- [ ] Add guard-inversion coverage on the dirty-check seam proving retirement still runs when the guard is negated on an otherwise eligible stale workspace with local edits.
- [ ] Update operator runbook and `v1-behaviors.md` per documentation updates below.

## Acceptance criteria

- [x] `cleanup.test.ts` adds a test that calls `resetStaleWorkspace` on a materialized worktree with uncommitted tracked or untracked paths, asserts `{ status: "refused", reason }` naming those paths and recovery options with no worktree/branch/PR retirement; fails against the pre-fix code.
- [x] `workflow.test.ts` adds a test that drives incomplete git-enabled `run workflow implement` re-run with a dirty managed worktree, asserts non-zero exit, operator stderr `Cannot re-run incomplete spec: …` naming the dirty paths and recovery, and no `gh pr close` / branch-delete / worktree-remove side effects; fails against the pre-fix code.
- [x] Dirty-listing failure refuses fail-closed: `reason` explains the failure, no `performAbandonmentSteps`, no retirement side effects.
- [x] Guard-inversion tests on the dirty-check seam fail when the guard is inverted: an otherwise eligible stale workspace with local edits retires as today instead of refusing.
- [x] `cleanup.test.ts` `resetStaleWorkspace: incomplete implement re-run reset` stays green.
- [x] `cleanup.test.ts` `abandon retires an unmerged workspace via git worktree remove --force, branch -D, and push origin --delete` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — extend the incomplete git-enabled re-run / pre-mutation refusal material (Implement workflow section and any parallel plan re-run stale-reset notes): **implement and plan** refuse stale reset when the managed worktree is dirty; operator stderr (via `Cannot re-run incomplete spec: …`) names dirty paths; recovery is commit, discard, or `jarvis cleanup --abandon <branch>` (no override flag in this slice). Cross-reference the existing pre-mutation refusal list where daemon connect / re-run behavior is documented.
- `v2/docs/v1-behaviors.md` — extend incomplete implement/plan re-run stale-reset behavior: refuse without mutation when the worktree has uncommitted tracked or untracked paths; cite `resetStaleWorkspace` and operator runbook.
