# Route draining runs through the stable daemon

Keep the stable address generation-transparent during handoff without changing the interim client socket-discovery boundary.

- [x] [00 - Establish handoff route readiness](./00-establish-handoff-route-readiness.md) — build a compatible, chain-safe route directory before serving the successor.
- [ ] [01 - Merge draining run observation](./01-merge-draining-run-observation.md) — retain owner authority separately from public liveness and compose stable list rows.
- [ ] [02 - Protect admission during handoff](./02-protect-admission-during-handoff.md) — keep starts and resumes off reachable draining worktrees.
- [ ] [03 - Route run waits and controls](./03-route-run-waits-and-controls.md) — relay owner-sensitive RPCs without transferring execution.
- [ ] [04 - Route run log streams](./04-route-run-log-streams.md) — relay replay and follow streams through owner routes.
- [ ] [05 - Reconcile lost run routes](./05-reconcile-lost-run-routes.md) — withdraw failed routes and recover only through existing dead-owner guards.
