# Abort failed worktree materialization

A workflow can continue after `git worktree add` fails to produce a valid managed worktree. Linked implement then reads routing state from the wrong location and may report a missing index instead of the Git failure.

## Decisions

- Materialize and validate the managed worktree before linked routing or an agent callback; rules out source-root routing fallback after a failed creation attempt.
- Validate a fresh worktree with the existing repository and branch checks before dependency provisioning; rules out treating subprocess success or path existence alone as proof of materialization.
- Raise a typed materialization failure carrying the managed path and original cause, and map it to daemon code `worktree_materialization_failed`; rules out `routing_read_failed`, generic `invalid_params`, or message sniffing.
- Leave failed-path reclamation to the separate managed-worktree-husk behavior; rules out deleting partial state in this change.

## Work

- Add post-creation validation at the external-worktree boundary before dependency provisioning and callback execution.
- Make linked workflow startup materialize first and propagate the typed failure through the daemon start response without creating a run row or invoking an agent.
- Add focused boundary and daemon regression coverage.
- Align durable workflow, daemon, operator, and v1-parity documentation.

## Acceptance criteria

- [ ] A workflow whose managed worktree cannot be created or fails fresh-worktree validation stops before routing reads, run-row creation, and agent invocation.
- [ ] The daemon `start` response uses `worktree_materialization_failed`, names the managed worktree path, and preserves the underlying Git or validation reason; it does not report `routing_read_failed`.
- [ ] Regression cases in `v2/src/execution/external-worktree.test.ts` and `v2/src/daemon/daemon-workflow-start.test.ts` simulate a successful `git worktree add` that leaves no valid worktree, assert no callback/routing/agent work occurs, and fail against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` document materialization-before-routing and the named start failure.

## Documentation updates

- `v2/docs/workflow-runner.md` — materialization and validation order relative to routing and callbacks.
- `v2/docs/daemon-host.md` — typed pre-row materialization failure and daemon response code.
- `v2/docs/operator-runbook.md` — operator diagnosis and retry semantics for `worktree_materialization_failed`.
- `v2/docs/v1-behaviors.md` — changed v2 workflow-start materialization behavior.
