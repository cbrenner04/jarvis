---
name: claim-refusal-precedes-stale-workspace-retirement
---

# Claim refusal precedes stale-workspace retirement

## Problem

An incomplete `jarvis run workflow implement` re-run retires the stale workspace — removing the
worktree, local branch, and remote branch — and *only then* is refused admission with
`worktree_claimed`. The refusal is a pre-mutation guard in name only: by the time it fires the
artifacts it protects are gone. Observed 2026-07-26 on
`20260725T004726Z-write-path-idle-output-watchdog`, destroying the branch's only completion commit
plus a dirty worktree of in-flight review edits.

The claim check lives at daemon admission (`start`), while `resetStaleWorkspace` runs client-side
before the daemon is ever asked. The claim condition was already true before retirement began.

## Decisions

- The `(project, branch)` claim is consulted before `resetStaleWorkspace` mutates anything, alongside the other pre-mutation refusals (live-held, non-draft PR, multiple open PRs, dirty worktree). Rules out keeping the ordering and only improving the error text.
- Ordering only: every existing refusal and destructive step keeps its behavior; this changes when the claim is consulted, not what it permits. Rules out relaxing the claim check so retirement can proceed past it.
- Out of scope: the wedged durable row (`in-progress` + `live`, zero agent processes) that held the claim — `ready-intents/every-live-workflow-is-killable` owns that.

## Acceptance criteria

- [ ] A re-run whose `(project, branch)` is claimed refuses with `worktree_claimed` and leaves worktree, local branch, remote branch, and open PR intact; a test asserts no retirement step ran and fails against the pre-fix ordering.
- [ ] That refusal prints no `Retirement destroyed artifacts:` block; a test asserts its absence.
- [ ] A run that is both claimed and dirty produces a single pre-mutation refusal and zero mutations; a test asserts this.
- [ ] An unclaimed re-run still retires the stale workspace as today — existing `v2/src/commands/cleanup.test.ts` `resetStaleWorkspace` tests stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow — `worktree_claimed` is a genuine pre-mutation refusal; drop the implication that a claim refusal is always free.
- `v2/docs/v1-behaviors.md` — record the changed refusal ordering.

## Prerequisites

- The daemon refuses workflow admission with a `worktree_claimed` error when a live run holds the `(project, branch)` key.
- `resetStaleWorkspace` runs client-side before workflow dispatch and already refuses on live-held, open-PR, and dirty-worktree conditions.
