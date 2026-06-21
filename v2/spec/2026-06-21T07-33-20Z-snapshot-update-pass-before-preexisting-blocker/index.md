# Snapshot update + re-test before a "pre-existing failures" blocker stands

When a patch-mode `## Blocker` cites pre-existing / unrelated / baseline test
failures, run an update-snapshots pass and re-test the agent working tree before
the blocker stands. If the suite then passes, the failures were outdated
snapshots the agent hadn't finished updating — snapshot churn, not breakage — so
the blocker is rejected. This catches churn even when the base ref is red, which
base-ref validation alone would let the blocker stand on.

- [ ] [00 - Reject blocker claims when an update-snapshots pass makes the suite green](./00-reject-snapshot-churn-blocker-claims.md)
- [ ] [01 - Resolve and run the target repo's update-snapshots command](./01-resolve-update-snapshots-command.md)

## Out of scope

- Base-ref reproduction of the cited failures — already shipped in
  `2026-06-21T06-11-30Z-validate-blocker-claims-against-base-ref`; this spec is the
  separate snapshot-churn gate that runs ahead of it.
- Auto-ticking acceptance criteria.
