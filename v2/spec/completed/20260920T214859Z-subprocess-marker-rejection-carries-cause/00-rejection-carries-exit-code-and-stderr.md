# Marker-wait rejections carry exit code, signal, and a stderr tail

## Problem

`waitForStdoutMarker` ([v2/src/testing/subprocess-marker.ts](../../src/testing/subprocess-marker.ts)) rejects on stdout `end` with `child closed stdout without reporting <marker> (startup or exit, not a deadline)`. `end` fires before `exit`, so the rejection carries no exit code, no signal, and no stderr — every such failure costs a re-run and a blind diagnosis.

## Decisions

- Reject on the child's `close` event, not `end` or `exit`: `close` fires after the stdio streams have drained, so the stderr tail is present and code and signal are supplied — rules out rejecting on `exit`, which can precede stderr drain and yield an empty tail.
- Stdout `end` without the marker no longer rejects by itself; the `end` listener is dropped and `close` is the single failure path — rules out keeping a second, cause-less rejection.
- No private wall clock on the wait for `close`: a child that closes stdout but never exits (e.g. a grandchild holding a pipe) hangs until the caller's test timeout — rules out reintroducing the startup deadline the helper was built to remove ([test-writing.md § private startup deadline](../../docs/test-writing.md)).
- Buffer stderr from call time, not from failure — rules out attaching a listener only once failure is detected.
- Retain only a bounded stderr tail in memory; tail size is the implementer's choice — rules out an unbounded buffer, since the wait is unbounded.
- Absent `stderr` (null, undefined, or inherited) degrades without throwing: no buffering, rejection omits the stderr text — mirrors the existing null-`stdout` guard.
- The bare "stdout `end` with no further event" case is no longer assertable (its promise never settles); the existing tests `rejects when the child exits without the marker` and `rejects when stdout closes without the marker` are rewritten to emit `close` and assert the new message, not left under a blanket "stays green".
- Success path and the no-deadline design are unchanged.

Deferred to first consumer: whether the helper releases stderr for caller reads after attaching its listener — pin when a caller needs it.

## Acceptance criteria

- [x] A regression test spawns a real child that writes to stderr, exits non-zero, and never prints the marker; it asserts the rejection message contains the exit code and the stderr text, and fails against the pre-fix helper.
- [x] A test using the fake-child harness in `subprocess-marker.test.ts` (deterministic `end` then `close`, no real spawn) asserts the rejection names the exit code, signal, and stderr tail rather than the bare `closed stdout` message; it fails against the pre-fix helper.
- [x] A fake-child test with no `stderr` asserts the helper still rejects with code and signal and does not throw.
- [x] A fake-child test writing more stderr than the retained tail asserts the rejection carries only the tail (the earliest output is absent).
- [x] The `waits past the former ten-second budget for a late marker` test in `v2/src/testing/subprocess-marker.test.ts` stays green (no private deadline reintroduced).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [v2/docs/test-writing.md](../../docs/test-writing.md): the `waitForStdoutMarker` guidance notes that marker-wait failures carry the child's exit code, signal, and a stderr tail, and that a child holding a pipe open without exiting hangs until the file's test timeout.
