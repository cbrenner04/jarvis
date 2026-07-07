# Ownership guard

Depends on [00 - Dispatch core](./00-dispatch-core.md). A workflow start must not be
able to double-claim a worktree already claimed by another live run or queued entry
for the same `(project, branch)`.

## Decisions

- Derive the `OwnershipKey` for a workflow start from the first step in `steps[]`.
  Field shape differs by `behavior` (confirmed against the current
  `AnyWorkflowStep` union, `v2/src/execution/workflow-runner.ts`): a `write` step
  carries `worktree.projectName`/`worktree.branchName` (same nested shape the bare
  `startHandler` already reads from `WriteLoopInput.worktree`); `human` and
  `review-debate` steps carry flat `project`/`branch` fields directly. Key
  derivation branches on `behavior` to read the right fields — no single flat
  `(project, branch)` accessor works across all three variants.
- Reuse the existing guards unchanged: `store.hasQueuedRun(key)` and
  `checkWorktreeClaimed(_registry, key)` (both used today in bare `startHandler`).
- No new claim/queue mechanism — same registry, same key derivation shape.
- Sequencing note: ownership enforcement for workflow starts only exists once
  this subspec lands. Subspecs land in index order, so between 00 landing and
  01 landing there is a transient window where a workflow start bypasses
  claim/queue checks entirely (00 does not add its own guard). Documented here
  as an accepted sequencing gap, not a redesign.

## Acceptance criteria

- [ ] A workflow start whose first step's `(project, branch)` is already claimed by a
      live run is rejected `worktree_claimed`.
- [ ] A workflow start whose first step's `(project, branch)` already has a queued
      run is rejected `worktree_claimed`.
- [ ] A workflow start for an unclaimed `(project, branch)` proceeds (dispatches to
      `executeWorkflow` per [00](./00-dispatch-core.md)).
- [ ] A workflow start whose first step has `behavior: "write"` derives its
      ownership key from `worktree.projectName`/`worktree.branchName`; one whose
      first step is `"human"` or `"review-debate"` derives it from flat
      `project`/`branch`.

## Documentation updates

- `v2/docs/daemon-host.md`: extend `### Admission guards for start, resume, revise`
  to note that a workflow start's ownership key comes from its first step, with
  field shape branching on that step's `behavior`, and that this guard is absent
  until this subspec lands (a transient gap after 00 alone lands).
