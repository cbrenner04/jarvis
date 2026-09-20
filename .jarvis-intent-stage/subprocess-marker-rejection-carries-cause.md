---
name: subprocess-marker-rejection-carries-cause
---

# `waitForStdoutMarker` rejections name the child's exit code and stderr

## Problem

`v2/src/testing/subprocess-marker.ts` rejects on stdout `end` with `child closed stdout without reporting <marker> (startup or exit, not a deadline)`. The `end` listener fires before `exit`, so the rejection carries no exit code, no signal, and no stderr — every failure costs a re-run and a blind diagnosis.

## Behavior

On failure the helper buffers the child's stderr, waits for `exit` (bounded only by the caller's test timeout, no private wall clock), and rejects with an error containing exit code, signal, and a stderr tail. Success behavior and the no-deadline design are unchanged.

## Prerequisites

- `waitForStdoutMarker` exists in `v2/src/testing/subprocess-marker.ts` and rejects when the child closes stdout without printing the marker.

## Notes

Documentation: `v2/docs/test-writing.md` — subprocess marker failures carry child stderr and exit code.
