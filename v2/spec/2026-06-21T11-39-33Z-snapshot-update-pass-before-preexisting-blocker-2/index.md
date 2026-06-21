# Snapshot update + re-test before a "pre-existing failures" blocker stands

When a patch-mode `## Blocker` cites pre-existing / unrelated / baseline test
failures and the base-ref check has not already rejected it, run a project's
update-snapshots command in the agent worktree and re-test. If the suite then
passes, the failures were outdated snapshots (the agent re-ran tests mid-edit),
not real breakage — reject the blocker and let the run continue. This catches
snapshot rot that base-ref reproduction misses (the failure reproduces at base
because the snapshots are stale there too).

- [x] [00 - Reject claim blockers when an injected snapshot-update re-test passes](./00-reject-snapshot-churn-blockers.md)
- [ ] [01 - Resolve and run the update-snapshots command, then re-test](./01-update-snapshots-runner.md)

## Out of scope

- Base-ref reproduction of the cited failures (already shipped in
  `2026-06-21T06-11-30Z-validate-blocker-claims-against-base-ref`). This gate runs
  only when base-ref validation did not reject.
- Auto-ticking acceptance criteria.
- Red completion-verdict (`ready-stuck-red`) snapshot churn — a separate mechanism
  from blocker exit 7.
