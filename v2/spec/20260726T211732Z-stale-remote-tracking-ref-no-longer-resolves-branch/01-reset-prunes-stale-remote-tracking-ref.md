# Reset prunes stale remote-tracking ref

## Problem

`performAbandonmentSteps` (`v2/src/commands/cleanup.ts`) deletes the remote branch with
`git push origin --delete` and treats "remote ref does not exist" as success, but leaves
`refs/remotes/origin/<branch>` in place. After preflight `resetStaleWorkspace`, that tracking ref
can still resolve the run branch name locally — violating intent that no local ref (including
tracking) may resolve the branch after reset, even though subspec 00 stops treating it as “on
origin” for materialization.

## Decisions

- After remote-branch deletion succeeds or is "already absent", explicitly remove
  `refs/remotes/origin/<branch>` when it still resolves locally (`git update-ref -d` or equivalent).
  Rules out relying on ls-remote alone while a stale ref remains on disk.
- Record a pruned stale remote-tracking ref in `DestroyedArtifacts` and surface it in
  `formatDestroyedArtifactsSummary` and per-step abandonment **stdout** during successful reset/abandon
  (not only stderr summary on failure). Rules out silent prune with no reporting.
- Prune runs in `performAbandonmentSteps` (shared by `resetStaleWorkspace` and `--abandon`). Rules
  out a reset-only fork of retirement steps.
- Prune is best-effort when the ref is already gone (no-op success). Rules out failing retirement
  because the tracking ref was absent.
- If deleting a still-present `refs/remotes/origin/<branch>` fails, **abort** retirement (same
  class as worktree removal / local or remote branch delete failure). Rules out leaving a resolving
  tracking ref while reporting success.
- **E2e scope:** implement incomplete re-run (`run workflow implement`) is the required workflow
  regression; plan re-run is in scope only via the same `resetStaleWorkspace` →
  `performAbandonmentSteps` chain (no separate plan workflow e2e required).

## Task checklist

- [ ] After the remote-delete step in `performAbandonmentSteps`, delete a resolving
  `refs/remotes/origin/<branch>` when present; extend `DestroyedArtifacts` (e.g.
  `remoteTrackingRef`) and summary/stdout formatting; abort retirement on delete failure.
- [ ] Add `cleanup.test.ts` coverage: fixture with worktree, local branch, and stale
  `origin/<branch>` tracking ref while bare `origin` lacks the head; `resetStaleWorkspace` removes
  all three classes of refs.
- [ ] Add `workflow.test.ts` regression `redispatch-materializes-from-base-after-preflight-reset-stale-remote-tracking-ref`:
  seed stale local branch + stale `refs/remotes/origin/<branch>` + external worktree, run incomplete
  `run workflow implement` re-run, assert the new worktree's branch tip matches `--base`, not the
  stale pre-merge tip.

## Acceptance criteria

- [ ] `cleanup.test.ts` `resetStaleWorkspace prunes stale origin tracking ref when remote head is absent`
  (or the implemented test name) fails against the pre-fix code and passes after the change.
- [ ] `workflow.test.ts` `redispatch-materializes-from-base-after-preflight-reset-stale-remote-tracking-ref`
  fails against the pre-fix code and passes after subspecs 00 and 01 land.
- [ ] Reset reporting names the pruned remote-tracking ref when one was removed (assert via
  `destroyed` record and/or abandonment stdout in `cleanup.test.ts`); fails against the pre-fix code.
- [ ] Guard-inversion on the prune step fails when inverted: stale `origin/<branch>` survives
  `resetStaleWorkspace` when the remote head is absent.
- [ ] `cleanup.test.ts` `abandon executes steps in order: remove worktree, delete local branch, delete remote branch, close PR` stays green (extend ordering/reporting assertions if the prune step is inserted).
- [ ] `cleanup.test.ts` describe `resetStaleWorkspace: incomplete implement re-run reset` stays green.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — hand-pushed/hand-merged run branches can leave
  `refs/remotes/origin/<branch>`; incomplete implement/plan re-run reset now prunes it and reports
  it in retirement output (stdout on success).
- `v2/docs/v1-behaviors.md` — extend the v2 incomplete re-run `resetStaleWorkspace` entry: stale
  remote-tracking refs are removed during retirement, not only local branch and remote delete.
