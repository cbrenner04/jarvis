# Seed: v2 implement re-run reuses the stale branch instead of re-implementing

## Problem

Re-running `jarvis run workflow implement` on a spec whose branch still exists on `origin`
(from a prior closed/superseded PR) **reuses the old committed work**: the run checks out the
existing branch, sees the acceptance criteria already ticked, reports `complete`, and pushes
nothing new. The operator sees the same stale SHA (observed 2026-07-16: `#1609` re-ran to the
identical hollow `c6f11d38`, `#1618` to `a379fd20`).

To force a genuine re-implementation the operator must hand-delete the origin branch
(`git push origin --delete <branch>`) + local worktree/branch first — there is no jarvis-native
"re-run this spec from scratch." v1 patch mode has this (external-spec git-backed re-run auto-reset:
closes the draft PR, deletes worktree/branch/origin, recreates from base); v2 does not.

Compounding: closing the PR **without** deleting the branch strands the next publish on
`gh pr ready` (targets the closed PR, masked as "transient network error"); recovery is to
reopen the PR. See [[failed-ready-flip-strands-the-run-and-hangs-the-cli]] and
[[publish-failure-is-always-a-transient-network-error]].

## Decisions

- A re-run of an incomplete spec must reset the branch to `base` (or refuse and tell the operator),
  not silently reuse ticked prior work.
- Fold into `jarvis` re-run/cleanup surface; do not require manual `git push origin --delete`.

## Acceptance criteria

- [ ] Re-running an implement spec whose origin branch holds prior (ticked) work re-implements
      from base rather than reporting `complete` with no new commit.
- [ ] The reset closes/reopens the matching PR cleanly (no `gh pr ready` strand).
- [ ] Regression coverage for the reuse path.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to cleanly re-run a v2 spec (replace the manual
  origin-branch-delete workaround once shipped).
