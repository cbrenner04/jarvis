---
name: tui-follows-daemon-source-revision
---

# A long-lived TUI keeps rendering with pre-merge client code after the daemon self-hands off

## Problem

Self-handoff ([#3864](https://github.com/cbrenner04/jarvis/pull/3864)) makes the daemon converge on a merged `v2/src` change with no operator action, but `jarvis tui` is a separate long-lived process that loads client code once at start. After a merge changes the client/daemon contract, an open TUI keeps interpreting the new daemon's responses with old code and can render wrong status — and nothing tells the operator. The only remedy is restarting the TUI on suspicion, which defeats the point of a monitor.

## Evidence (2026-09-14)

TUI process started 2h55m earlier, before [#3897](https://github.com/cbrenner04/jarvis/pull/3897) (removed client-side socket discovery; the TUI previously discovered keyed sockets and built its own ownership maps). The daemon had self-handed off to `5c8a45107` (#3897). The TUI then showed plan run `576c67ce` as `in-progress` / `live`, while `jarvis run list` and the durable store both read `completed` / `not-live` and its run log ended `loop_finished`. One daemon process, one generation. Restarting `jarvis tui` fixed the row immediately.

## Decisions

- The TUI compares its own loaded source revision against the daemon's `loadedRevision` (already served for `daemon status`, `v2/src/daemon/daemon-lifecycle.ts`) on connect and on each poll.
- On mismatch the TUI re-execs itself onto current code, preserving selection/expansion state where cheap; rules out a passive banner the operator must act on (north star: fewer manual steps).
- Re-exec only once the daemon's revision is stable (not mid-handoff) and never while a dock command is half-typed; defer until the input is empty.
- `tui log <run-id>` follows the same rule.
- Out of scope: other one-shot CLI commands (they load fresh code per invocation).

## Acceptance criteria

- [ ] A test proves a TUI whose loaded revision differs from the daemon's `loadedRevision` re-execs onto the current revision without operator input; it fails against the pre-fix TUI, which never compares revisions.
- [ ] A test proves no re-exec happens while the dock input is non-empty, and that it happens once the input clears.
- [ ] A test proves matching revisions never re-exec.
- [ ] `tui log` follows the same rule, with its own test.
