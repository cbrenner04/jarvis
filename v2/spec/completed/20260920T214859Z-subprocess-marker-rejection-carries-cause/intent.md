---
name: subprocess-marker-rejection-carries-cause
---

# `waitForStdoutMarker` rejections name the child's exit code and stderr

## Problem

`v2/src/testing/subprocess-marker.ts` rejects on stdout `end` with `child closed stdout without reporting <marker> (startup or exit, not a deadline)`. The `end` listener fires before `exit`, so the rejection carries no exit code, no signal, and no stderr — every failure costs a re-run and a blind diagnosis.

## Behavior

On failure the helper buffers the child's stderr, waits for `exit` (bounded only by the caller's test timeout, no private wall clock), and rejects with an error containing exit code, signal, and a stderr tail; the tail size is the implementer's choice. Success behavior and the no-deadline design are unchanged.

A child that closes stdout but never exits (e.g. a grandchild holding the pipe) hangs until the caller's test timeout; accepted, since the timeout already bounds the wait.

A regression test spawns a child that exits non-zero, writes to stderr, and never prints the marker; it asserts the rejection message contains the exit code and the stderr text, and fails against the pre-fix helper.

## Prerequisites

- `waitForStdoutMarker` exists in `v2/src/testing/subprocess-marker.ts` and rejects when the child closes stdout without printing the marker.

## Notes

Documentation: `v2/docs/test-writing.md` — subprocess marker failures carry child stderr and exit code.
