---
name: cleanup-abandons-v2-workspaces
---

# Cleanup abandons a wedged v2 workspace

`jarvis cleanup --abandon <name>` previews and confirms retirement of one unmerged or wedged v2 run even when the daemon no longer recognizes it as active. Cleanup closes one matching draft PR best-effort, force-removes the worktree, deletes the local and remote branches, and leaves the spec available for a fresh run. It refuses ambiguous PR ownership or a worktree held by another live run.

## Decisions

- Filesystem, Git, lock, and PR state authorize abandonment without daemon agreement; rules out making leaked daemon state an unrecoverable cleanup gate.
- Leave the source spec and durable run rows intact; rules out treating abandonment as completed work or history deletion.
- Refuse a ready PR or multiple matching PRs; rules out force-retiring operator-reviewed or ambiguously owned work.

## Out of scope

- Reaping the daemon's in-memory wedged run.
- Automatically restarting implementation.
- Merged-workspace cleanup and spec archival.

## Prerequisites

- `jarvis cleanup` can resolve v2 workspace names and detect live workspace ownership.

## Documentation updates

- `v2/docs/operator-runbook.md` — wedged-run abandonment and clean re-run recovery.
