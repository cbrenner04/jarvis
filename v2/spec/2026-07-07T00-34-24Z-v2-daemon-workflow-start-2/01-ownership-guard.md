# Ownership guard

Depends on [00 - Dispatch core](./00-dispatch-core.md). A workflow start must not be
able to double-claim a worktree already claimed by another live run or queued entry
for the same `(project, branch)`.

## Decisions

- Derive the `OwnershipKey` for a workflow start from the first identifiable step's
  `(project, branch)` (first step in `steps[]` carries these fields on every
  `AnyWorkflowStep` variant — `write`, `human`, `review-debate`).
- Reuse the existing guards unchanged: `store.hasQueuedRun(key)` and
  `checkWorktreeClaimed(_registry, key)` (both used today in bare `startHandler`).
- No new claim/queue mechanism — same registry, same key derivation shape.

## Acceptance criteria

- [ ] A workflow start whose first step's `(project, branch)` is already claimed by a
      live run is rejected `worktree_claimed`.
- [ ] A workflow start whose first step's `(project, branch)` already has a queued
      run is rejected `worktree_claimed`.
- [ ] A workflow start for an unclaimed `(project, branch)` proceeds (dispatches to
      `executeWorkflow` per [00](./00-dispatch-core.md)).

## Documentation updates

- `v2/docs/daemon-host.md`: extend `### Admission guards for start, resume, revise`
  to note that a workflow start's ownership key comes from its first step.
