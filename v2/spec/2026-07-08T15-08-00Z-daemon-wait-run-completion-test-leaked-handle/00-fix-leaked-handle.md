# Fix leaked handle in daemon-wait-run-completion.test.ts

CI's per-file timeout on `Test (v2)` intermittently names `v2/src/daemon/daemon-wait-run-completion.test.ts`
as the staller (#1170, #1171): assertions pass, but the `bun test` worker for this file
does not exit within the per-file timeout afterward — a leaked open handle (socket, `fs.watch`
watcher, or bare timer) outlives test teardown.

## Decisions

- Find and close the actual leaked handle; do not raise or add a per-file timeout for this file.
- Prime suspect: `createRunControlHandlers`'s per-run wait fanout (`ensureWaitFanout` in
  `v2/src/daemon/daemon.ts`) spawns a fire-and-forget `logReader.follow()` consumer per `runId`
  backed by `FsAppendWake`'s `fs.watch` (`v2/src/persistence/log-stream.ts`). A fanout whose
  backing watcher/timer survives past a test's `afterEach` (e.g. a run created but never driven
  to a terminal state, or a fanout whose consuming loop hasn't finished its `finally` before the
  test file ends) is a leaked handle candidate.
- `afterEach` in the test file must deterministically close everything it opened: `logSink`,
  `stateStore`, and any in-progress runs' wait fanouts/watchers reachable through `handlers`. If
  `createRunControlHandlers` has no way to tear down live fanouts, add one (e.g. a `close()`/`dispose()`
  on the returned handlers, or ensure every test drives its created runs to a terminal status before
  `afterEach`) rather than leaving the test to leak by construction.
- If the root cause is instead a bare timer without `unref()` (e.g. `FsAppendWake`'s `ABORT_POLL_MS`
  `setTimeout`), fix at the source (`log-stream.ts`), not by papering over it in the test.
- Documentation scope depends on which fix lands: a test-only `afterEach` teardown needs no
  `v1-behaviors.md` update; a source-level change to production/runtime code (e.g. `log-stream.ts`,
  `daemon.ts`) is a change to existing functionality and must update `v2/docs/v1-behaviors.md` to
  record the corrected behavior.

## Task checklist

- [ ] Reproduce the hang: stress-run the file in isolation and confirm the worker process does not
      exit promptly after the last test.
- [ ] Root-cause the specific leaked handle (watcher, timer, or socket).
- [ ] Fix at the source — either close the handle deterministically in `afterEach`, or fix the
      producing code so it never outlives its owning test/run.
- [ ] Stress-verify the fix.

## Acceptance criteria

- [ ] `for i in $(seq 1 50); do timeout 30 bun test v2/src/daemon/daemon-wait-run-completion.test.ts; done`
      (sandbox-off) passes all 50 iterations, with the process exiting within 1s wall-clock of the
      last test completing each run — not merely under the 30s CI timeout.
- [ ] `bun run test:v2` and `bun run test:integration:v2` stay green (no regression from the fix).
- [ ] If the fix changes production/runtime code (not test-only teardown), `v2/docs/v1-behaviors.md`
      reflects the corrected behavior.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate (near the `Test (v2)` per-file-timeout bullet): note
  that the intermittent `daemon-wait-run-completion.test.ts` staller was root-caused to a leaked
  handle and resolved — a named per-file timeout on that file is no longer expected going forward.
- `v2/docs/v1-behaviors.md`: update only if the fix changes production/runtime code; not required
  for a test-only `afterEach` teardown fix.
