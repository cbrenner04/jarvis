---
name: daemon-wait-run-completion-test-leaked-handle
---

# `daemon-wait-run-completion.test.ts` leaks a handle and hangs its test worker

CI's per-file timeout on `Test (v2)` names `v2/src/daemon/daemon-wait-run-completion.test.ts`
as the intermittent staller (#1170, #1171): tests pass fast, but the file's `bun test` worker
fails to exit within the per-file timeout — a leaked open handle (socket/watcher/timer without
`unref()`) outlives teardown.

## Decisions

- Find and close the leaked handle so the worker exits promptly after tests finish. Likely
  culprits: an `IpcServer`/socket or `WaitFanout`/`follow()` watcher started in a test and not
  aborted/closed in `afterEach`; a `connectIpcClient` client left open; a `setTimeout`/`setInterval`
  without `unref()`. Ensure `afterEach` deterministically tears down every server/client/waiter/watcher
  it created.
- Verify by stress-running the file in isolation (`for i in $(seq 1 50); do timeout 30 bun test
  v2/src/daemon/daemon-wait-run-completion.test.ts …`), sandbox-off, confirming the process exits
  immediately after the last test.
- Do not raise the per-file timeout — remove the leak, don't tolerate it.

## Out of scope

- Other socket test files (audit only if this fix reveals a shared teardown helper at fault).
- The per-file timeout machinery itself.

## Documentation updates

- `v1/docs/operator-runbook.md` (§ The gate): note the staller was root-caused to a leaked handle
  in `daemon-wait-run-completion.test.ts` and resolved; a named per-file timeout on that file is no
  longer expected.

## Prerequisites
