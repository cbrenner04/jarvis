---
name: pipeline-stage-redispatch-rebases-onto-moved-base
---

# Pipeline stage re-dispatch refuses a clean committed lane once main moves

## Problem

`jarvis pipeline resume <id> [<branch>]` on a failed chained implement stage whose lane has commits ahead of base and a clean tree refuses `Cannot re-run incomplete spec: worktree HEAD <sha> is not a descendant of base main (<sha>); stale reuse refused` as soon as `main` moves. Observed 4× on 2026-09-30: pipeline `f13b29a3` lane `configure-session-log-retention-tiers` (twice: HEAD `c9d6b7e55`, then `f99ab14b2`), `fe47cd00` cursor-quota (HEAD `e2fa5aaed`), `a0681d04` non-terminating (predicted). Each time the operator hand-merged `origin/main` into the lane, pushed, and resumed — one manual step per main merge, racing further merges.

Mechanism (line numbers drift):

- Pipeline re-dispatch reaches the same gate as standalone: `v2/src/daemon/pipeline-execution.ts` ~1778 and `pipeline-workflow-preparation.ts` ~95 call `maybeResetStaleWorkspace` → `resetStaleWorkspace`.
- `cleanup.ts` ~2973 sets `trackableSpecPath` only when `isStaleResetLandedCriteriaSpecPath` (~2821) is true; that returns false for any spec outside `projectRoot` (~2829). A chained stage's spec lives in the prior stage's worktree under `~/.jarvis/worktrees/...`, so it is never trackable.
- `evaluateCommittedLaneContinuation` (~2714) refuses as a plain non-descendant when `trackableSpecPath === undefined`, so the rebase branch (~2724) is never taken for chained stages.

The out-of-root exclusion was added to stop the tick-backing comparison reading a nonexistent path; it also silently disabled rebase continuation.

## Decisions

- Pipeline stage re-dispatch continues a clean committed lane behind a moved base like standalone continuation: the rebase gate keys on "spec readable somewhere" (in-root or chained out-of-root), not on in-root.
- Tick-backing for an out-of-root spec reads the spec at its own location, not via `relative(projectRoot, …)`; if that is not meaningful, tick-backing is skipped for it (as today) but the rebase still runs.
- Lane with no published PR: rebase onto base (existing `rebaseWorktreeOntoBase`), record `preRebaseSha` as `leaseFromSha`.
- Lane whose PR is already published: merge base into the lane instead of rebasing, so the remote tip stays an ancestor and the next push is fast-forward — no foreign-tip rewrite, no lease needed. If a rebase is chosen anyway, `leaseFromSha` must equal the pushed remote tip, else refuse naming the foreign tip.
- Conflicts abort (tree and branch unchanged) and refuse naming base, conflicting paths, and `jarvis cleanup --abandon <branch>`.
- No shared history, or a dirty tree, still refuses as today.

## Acceptance criteria

- [ ] Temp-git test: chained stage with out-of-root spec, clean lane ahead of a moved base, no PR → re-dispatch continues on a rebased tip descending from base; `leaseFromSha` = pre-rebase head.
- [ ] Temp-git test: same with an open PR (fake PR gate) → base merged into lane; old tip is an ancestor of new tip; no rebase.
- [ ] Temp-git test: conflicting base change → refusal names conflicting paths; branch and tree byte-identical to before.
- [ ] Temp-git test: no common ancestor → existing non-descendant refusal unchanged.
- [ ] Existing in-root standalone continuation tests pass unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates: "Descendant, or rebased onto a moved base" covers chained out-of-root stage specs and the merge-when-PR-published path; drop the hand-merge-main workaround if documented.
- [ ] `v2/docs/v1-behaviors.md` only if it describes this gate.
