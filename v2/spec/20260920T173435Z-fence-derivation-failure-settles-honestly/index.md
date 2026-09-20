# Fence-derivation failure is logged and does not fail a published lane

Derivation failure in `deriveGateAllowedPaths` currently collapses to bare `undefined`, reaches the write-loop as an unlogged bare `Error`, and settles `completion_commit_failed` with `nextAction: resume` on a lane whose branch is already pushed and whose draft PR is already open.

- [ ] [00-named-derivation-failure-reasons.md](00-named-derivation-failure-reasons.md) — every derivation failure returns a distinct named reason instead of bare `undefined`
- [ ] [01-log-derivation-reason-before-settlement.md](01-log-derivation-reason-before-settlement.md) — the write-loop writes the named reason to the run log before settling
- [ ] [02-published-lane-settles-honestly.md](02-published-lane-settles-honestly.md) — a published lane does not settle `completion_commit_failed`, and residual settlement advertises `stop`
