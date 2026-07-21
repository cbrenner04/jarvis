# Match stranded ownership by project and branch

`jarvis cleanup` currently treats a spec file present in any materialized worktree as owned, so unrelated worktrees containing the merged spec block stranded archival.

## Decisions

- The authoritative spec branch is the branch recorded for that spec's implementation, including an explicit `--branch` selection; do not derive it from the spec path or directory name.
- Treat only a discovered managed worktree in the same registered project and on that exact branch as a materialized owner; primary checkouts and resolved unrelated branches, including `main`, are not owners.
- Revalidate ownership immediately before archival so a matching worktree that appears after discovery or confirmation still refuses archival.
- Fail closed: a same-project discovered managed worktree with unresolved branch identity, including detached `HEAD`, refuses stranded archival. This does not make primary checkouts owners.
- Change only stranded-artifact ownership; rules out altering retirement archival gates.

## Work

- Replace stranded file-presence ownership detection with same-project, authoritative-branch matching and final archival revalidation.
- Update the stranded cleanup regression to cover custom `--branch` identity, unrelated file presence, an identical branch in another project, a late matching owner, and unresolved or detached managed worktrees.
- Align the operator runbook and v1 parity catalog with branch-keyed stranded ownership.

## Acceptance criteria

- [x] A completed, merged open-home spec remains eligible for archival when a primary checkout or a discovered managed worktree on `main` or another resolved unrelated branch contains the merged spec path.
- [x] A same-project discovered managed worktree on the spec's recorded implementation branch, including a custom `--branch` value, prevents archival with the existing `another materialized worktree owns this spec` refusal.
- [x] A discovered managed worktree in another registered project with the same branch name does not prevent archival.
- [x] Ownership is rechecked at archival time, and a matching managed worktree materialized after earlier discovery or confirmation prevents archival with the ownership refusal.
- [x] A same-project discovered managed worktree with unresolved branch identity or detached `HEAD` prevents archival; primary checkouts remain outside this check.
- [x] `v2/src/commands/cleanup.test.ts` proves ownership uses the recorded implementation branch rather than spec path or directory name; covers unrelated file presence, cross-project duplicate branches, late owners, and unresolved or detached worktrees; it fails against the pre-fix code and passes after implementation.
- [x] Existing stranded-eligibility tests for closed-unmerged, missing-PR, and other ineligible specs stay green.
- [x] `v2/docs/operator-runbook.md` defines same-project, branch-keyed managed-worktree ownership, final revalidation, and unresolved/detached fail-closed behavior; it no longer describes file presence as ownership.
- [x] `v2/docs/v1-behaviors.md` records the same branch-keyed stranded-archival v2 parity delta.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — define branch-keyed, same-project managed-worktree ownership; document final revalidation and fail-closed unresolved/detached worktrees.
- `v2/docs/v1-behaviors.md` — align the v2 stranded-archival parity delta.
