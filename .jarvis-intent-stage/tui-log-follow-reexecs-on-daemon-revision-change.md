---
name: tui-log-follow-reexecs-on-daemon-revision-change
---

# `tui log <run-id>` re-execs onto current code when the daemon's loaded revision differs

`tui log` is a separate long-lived follow surface (`v2/src/tui/tui-log-follow-entry.tsx`) with the same stale-client risk as the monitor.

## Behavior

- `tui log` applies the monitor's rule: compare its loaded source revision with the daemon's `loadedRevision` on connect and each poll; on mismatch with a stable daemon revision, re-exec onto current code for the same run id.
- Reuses the monitor's decision predicate; matching revisions never re-exec.

## Acceptance

- A `tui log` test proves a revision mismatch re-execs for the same run id without operator input (fails pre-fix), and matching revisions do not.

## Prerequisites

- TUI monitor compares its loaded source revision to the daemon's `loadedRevision` and re-execs on a stable mismatch via a reusable decision predicate.
