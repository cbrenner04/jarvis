---
name: commit-completed-run-worktree
---

# Commit completed-run worktree changes with agent attribution

## Problem

The v2 write loop persists its completion boundary in SQLite but leaves changed
files uncommitted in the external worktree. The completed run therefore has no
durable git boundary or commit SHA for later publication and telemetry.

## Direction

At the runner/write-loop boundary, stage and commit a dirty external worktree
when the run reaches the applicable terminal completion boundary. Append a
`Jarvis-Agent: <label>` trailer using the binding agent label. Use a
`Spec:`-style first body line so the existing attribution convention can select
the commit later. A clean worktree is a successful no-op.

Keep git side effects outside `commitCompletionBoundary`, its SQLite
transaction, and the orchestration store API. Keep the execution core
host-agnostic and make subprocess execution injectable. Use the v2 external
worktree as-is; do not port v1 `.worktree/`, lock-exclusion, or symlink behavior.

## Decisions

- The runner owns the git commit after durable boundary persistence — rules out git mutation inside the SQLite transaction or state store.
- Harness commits carry the binding agent label in a `Jarvis-Agent` trailer — rules out deriving attribution from the model, role, or process environment.
- Clean completion is a no-op — rules out empty commits or treating no diff as failure.
- Commit bodies retain a `Spec:`-style selector line — rules out an incompatible message shape that later attribution cannot discover.

Deferred to first consumer: exact commit subject and `Spec:` value — pin when the runner exposes the available spec identity.

## Documentation updates

- Add the completed-run commit boundary and external-worktree ownership to the durable v2 write/PR lifecycle doc.
- Mark the ported commit and trailer behavior in `v2/docs/v1-behaviors.md`.

## Prerequisites

- The v2 write loop persists terminal completion through a transactional completion boundary
