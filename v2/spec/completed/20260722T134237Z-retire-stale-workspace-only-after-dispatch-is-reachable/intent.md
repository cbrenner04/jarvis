---
name: retire-stale-workspace-only-after-dispatch-is-reachable
---

# Retire the stale workspace only after dispatch is reachable

## Problem

`jarvis run workflow implement|plan` retires the stale workspace — closes the open draft PR, removes
the worktree, deletes the local and remote branches — in `maybeResetStaleWorkspace`, which
`runWorkflowCommand` calls *before* `withConnectDispatch`. Any preflight refusal on the dispatch side
(daemon unreachable, lifecycle/start failure, whatever guard occupies that seam next) therefore
arrives after the prior attempt's work is already destroyed. Observed 2026-07-21 against
`20260721T115738Z-workflow-command-reports-terminal-workflow-failure`: PR #1911 closed, worktree
removed, both branch refs deleted, then the run exited without dispatching. The revision guard that
fired has since been retired, but the ordering defect outlives it — every refusal reachable after
retirement has the same shape.

## Decisions

- Establish that the invocation can dispatch before mutating any workspace state; retire inside the
  connected scope. Rules out reordering one specific guard while leaving other refusal paths ahead
  of retirement.
- Keep the retirement refusal (`Cannot re-run incomplete spec`) a non-dispatching exit. Rules out
  connecting and then starting a run whose workspace could not be reset.

## Acceptance criteria

- [ ] A `run workflow implement` invocation that cannot reach dispatch performs no PR closure,
      worktree removal, or branch deletion against an existing stale workspace.
- [ ] Regression coverage drives that failure against a populated workspace and asserts the PR,
      worktree, and both branch refs survive; it fails against the current ordering.
- [ ] The happy path still retires the stale workspace and then dispatches, with unchanged stdout.
- [ ] A retirement refusal still exits non-zero without starting a run.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § implement workflow — retirement runs only after the invocation is
  known dispatchable.
- `v2/docs/v1-behaviors.md` — record the changed preflight ordering.

## Prerequisites
