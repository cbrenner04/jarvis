---
name: reclaim-managed-worktree-husks
---
# Reclaim managed worktree husks

## Outcome

- A retry removes an unregistered, non-Git directory at its managed worktree path and materializes the expected branch there.
- Recovery needs no manual directory removal or Git worktree pruning.

## Decisions

- Reclaim only paths proven to contain no Git worktree state; rules out deleting a valid worktree for another repository or branch.
- Rebuild the target during the same locked materialization attempt; rules out accepting the husk as reusable or requiring a separate retry.

## Durable documentation

- Update worktree recovery/operator semantics and the v1 behavior catalog in the same subspec.

## Prerequisites

- External worktree materialization holds the branch-scoped worktree lock through validation and creation.
