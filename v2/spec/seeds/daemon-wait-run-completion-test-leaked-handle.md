---
name: daemon-wait-run-completion-test-leaked-handle
---

# `daemon-wait-run-completion.test.ts` leaks a handle and hangs its test worker

Now that agent-mode test runners bound and name a hung file per-file (see
`agent-mode-v2-tests-per-file-timeout` / `run-tests-agent-mode-per-file-timeout`), the
long-intermittent `Test (v2)` staller is identified: `v2/src/daemon/daemon-wait-run-completion.test.ts`.
CI fails with `error: v2 "agent" test run timed out or was killed on file
"v2/src/daemon/daemon-wait-run-completion.test.ts"`, observed on ≥2 consecutive unrelated PRs
(#1170, #1171 — neither touches that file). The tests themselves pass fast; the file's `bun test`
worker then fails to exit within the per-file timeout, i.e. a leaked open handle (a socket/server
not destroyed, or an unref-less timer/waiter) keeps the process alive past the tests.

This is intermittent (a teardown/timing race), so it survived earlier bounded-timeout work — the
per-file naming is what finally pinned it.

## Decisions

- Find and close the leaked handle in `daemon-wait-run-completion.test.ts` so its worker exits
  promptly after the tests finish. Likely culprits: an `IpcServer`/socket started in the test and
  not `close()`d/`destroy()`d in `afterEach`; a `connectIpcClient` client left open; a `WaitFanout`
  waiter or `nextFrame()` parked without a bounded `timeoutMs`; or a `setTimeout`/`setInterval`
  without `unref()`. Ensure `afterEach` deterministically tears down every server/client/waiter it
  created (destroy client sockets, `close()` servers, resolve/reject parked waits).
- Verify by stress-running the file in isolation many iterations under a short outer timeout
  (`for i in $(seq 1 50); do timeout 30 bun test v2/src/daemon/daemon-wait-run-completion.test.ts …`)
  sandbox-off until it no longer hangs; and confirm the process exits immediately after the last test.
- Do not raise the per-file timeout — the point is to remove the leak, not tolerate it.

## Out of scope

- Other socket test files (audit them only if this fix reveals a shared teardown helper at fault).
- The per-file timeout machinery itself (already shipped).

## Documentation updates

- `v1/docs/operator-runbook.md` (§ The gate): once fixed, note the staller was root-caused to a
  leaked handle in `daemon-wait-run-completion.test.ts` and resolved, so a named per-file timeout on
  that file is no longer expected.
