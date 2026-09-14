---
name: tui-monitor-reexecs-on-daemon-revision-change
---

# TUI monitor re-execs onto current code when the daemon's loaded revision differs

Self-handoff converges the daemon on merged `v2/src`, but a long-lived `jarvis tui` keeps pre-merge client code and can render wrong status (2026-09-14: plan run `576c67ce` shown `in-progress`/`live` after #3897 handoff while the store read `completed`). The TUI monitor must follow the daemon's revision without operator action.

## Behavior

- On connect and each poll, the monitor compares its own loaded source revision with the daemon's `loadedRevision` (served for `daemon status`, `v2/src/daemon/daemon-lifecycle.ts`; already read in `v2/src/tui/tui-daemon-client.ts`).
- On mismatch it re-execs itself onto current code, preserving selection/expansion state where cheap. No passive banner.
- Re-exec only once the daemon revision is stable (not mid-handoff), and never while the dock input is non-empty; defer until it clears.
- Matching revisions never re-exec.
- The revision-compare/stability/re-exec decision is a pure exported predicate tested in both directions; the re-exec itself is injected for tests.
- Out of scope: one-shot CLI commands.

## Acceptance

- A test proves a monitor whose loaded revision differs from the daemon's `loadedRevision` re-execs without operator input; fails pre-fix.
- A test proves no re-exec while dock input is non-empty, and re-exec once it clears.
- A test proves matching revisions never re-exec.

## Prerequisites
