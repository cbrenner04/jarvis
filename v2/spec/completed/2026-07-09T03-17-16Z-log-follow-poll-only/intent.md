---
name: log-follow-poll-only
---

# Make log follow poll-only

## Problem

`v2/src/persistence/log-stream.ts` runs `FsAppendWake` (`fs.watch` plus a
directory-missing fallback and a dirty flag) as its primary append signal,
with a 500ms `ABORT_POLL_MS` poll layered on top because the watcher is
already treated as unreliable. The watcher is also the residual source of the
`daemon-wait-run-completion.test.ts` leak: #1191 `.unref()`-ed the inotify
`FSWatcher` but didn't remove it, and the file still intermittently times out
`Test (v2)` on Linux (e.g. #1204).

## Direction

Delete `FsAppendWake` and the `AppendWake`/factory seam; follow polls on a
named interval only.

## Decisions

- Poll interval is a named constant, 250-500ms — rules out an unnamed magic
  number restated at each call site.
- Flagged behavior change: follow latency becomes the poll interval instead
  of near-immediate `fs.watch` notification.
- Acceptance must confirm `daemon-wait-run-completion.test.ts` no longer
  intermittently times out on Linux CI (stress via repeated runs), and the
  operator-runbook "The gate" note (currently marked residual) flips to
  resolved — this is the fix for the #1191/#1204 leak, not just a cleanup.

## Documentation updates

- `v1/docs/operator-runbook.md` — flip "The gate" residual-leak note to
  resolved.

## Prerequisites
