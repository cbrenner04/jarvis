---
name: pipeline-stage-redispatch-rebases-onto-moved-base
---

# Pipeline stage re-dispatch continues a clean committed lane when base moves

Unsplit rationale: continuation eligibility, out-of-root spec tick-backing, rebase-vs-merge-when-PR, and conflict refusal all live in `resetStaleWorkspace` / `evaluateCommittedLaneContinuation` in `v2/src/commands/cleanup.ts`; CLI and daemon pipeline preflight already call that path unchanged.

## Primary implementation surface

- Stale-reset workspace continuation (`v2/src/commands/cleanup.ts`, consumed via `v2/src/commands/stale-reset-workspace.ts`).

## Problem

`jarvis pipeline resume` on a failed chained implement stage with a clean lane whose commits are ahead of base refuses `worktree HEAD … is not a descendant of base main …; stale reuse refused` as soon as `main` moves, because `trackableSpecPath` is cleared for specs outside `projectRoot` and `evaluateCommittedLaneContinuation` treats that as a plain non-descendant with no rebase.

## Decisions

- Rebase continuation keys on a readable write-step spec path (in-root or chained out-of-root), not on `isStaleResetLandedCriteriaSpecPath` alone; landed-criteria drift and in-root tick-backing still use the in-root gate.
- Out-of-root tick-backing reads the spec at its absolute path when meaningful; when not meaningful, skip tick-backing but still allow rebase continuation.
- No open PR: rebase onto base via `rebaseWorktreeOntoBase`, return `preRebaseSha` as `leaseFromSha` on `continue`.
- Open draft PR: merge base into the lane instead of rebasing so the remote tip stays an ancestor; if rebase is used anyway, `leaseFromSha` must equal the pushed remote tip or refuse naming the foreign tip.
- Rebase/merge conflicts abort with tree and branch unchanged; refusal names base, conflicting paths, and `jarvis cleanup --abandon <branch>`.
- No shared history or a dirty tree still refuse as today.

## Acceptance criteria

- [ ] A temp-git test drives `resetStaleWorkspace` for a chained stage with an out-of-root spec, a clean lane ahead of a moved base, and no open PR; it continues on a rebased tip descended from base with `leaseFromSha` equal to the pre-rebase head, and fails against the pre-fix refusal.
- [ ] A temp-git test with the same shape and a faked open-PR gate merges base into the lane, leaves the old tip an ancestor of the new tip, performs no rebase, and fails against the pre-fix rebase-only path.
- [ ] A temp-git test with a conflicting base change refuses naming conflicting paths with branch and worktree byte-identical to before the attempt, and fails if mutation occurs.
- [ ] A temp-git test with no common ancestor keeps the existing non-descendant refusal unchanged.
- [ ] `resetStaleWorkspace: incomplete implement re-run reset` in-root standalone continuation tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — update "Descendant, or rebased onto a moved base" for chained out-of-root stage specs and merge-when-PR-published; remove any hand-merge-main workaround.
- [ ] `v2/docs/v1-behaviors.md` — update the incomplete re-dispatch continuation entry if it still describes in-root-only rebase gating or rebase-with-open-PR as the only path.

## Prerequisites
