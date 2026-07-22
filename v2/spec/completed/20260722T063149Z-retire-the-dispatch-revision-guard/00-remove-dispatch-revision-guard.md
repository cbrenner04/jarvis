# 00 - Remove the revision guard and `--no-auto-bounce` from dispatch

## Problem

`v2/src/cli/dispatch-revision.ts` compares the invoking executable digest against the daemon's
`loadedExecutableDigest` before every mutating dispatch, and `withAutoBounceDispatch` in
`v2/src/cli/stale-dispatch.ts` force-restarts an idle daemon on mismatch or refuses when any row is
`isLive`. `v2/src/tui/tui-daemon-client.ts` runs the same comparison before `start`/`resume`.
Since `v2/src/cli.ts` keys socket/PID/log paths by `daemonPathsByDigest(digest)`, a connected daemon
is always at the invoking digest, so the mismatch branch is unreachable — but the live-run refusal
and the bounce machinery still ride along on every dispatch.

## Decisions

- Delete the comparison and the bounce path instead of short-circuiting them; rules out leaving dead compatibility machinery beside keyed routing.
- Keep `getInvokingRevision` / `getInvokingExecutableDigest`; `v2/src/cli.ts` keying and `daemon status` still call them, so wholesale module deletion is wrong.
- Delete `advanceLoadedRevision` and stop sending `currentRevision` / `currentExecutableDigest` on `status`; with no caller sending them the daemon's in-process HEAD advance has no input.
- Keep `loadedRevision` / `loadedExecutableDigest` in the `status` reply; `jarvis daemon status` and the TUI read them for display.
- Rename `withAutoBounceDispatch` to a name that describes connect-and-dispatch; rules out a bounce-named helper that never bounces.
- Delete `stripAutoBounceFlag` rather than keeping a no-op accepted flag; existing arg parsers then reject `--no-auto-bounce` as unknown.
- Out of scope: `getDaemonStatus`'s `stale` state in `v2/src/daemon/daemon-lifecycle.ts` and the `daemon status` output line — read-only reporting, not dispatch.

## Acceptance criteria

- [x] `run start`, `run resume`, and `run workflow` dispatch to a daemon whose reported `loadedExecutableDigest` differs from the invoking digest without stopping, restarting, or refusing — including when `list` reports `isLive` rows. A regression test in `v2/src/commands/run.test.ts` asserts this and fails against the pre-change guard.
- [x] TUI `start` and `resume` dispatch without a digest comparison; a test in `v2/src/tui/tui-daemon-client.test.ts` asserts no `status` request precedes them and fails against the pre-change guard.
- [x] `--no-auto-bounce` on `run start` and `run workflow implement` exits 1 with usage output, and no usage string in `v2/src/cli/usage.ts` or `v2/src/commands/workflow.ts` mentions it.
- [x] No dispatch path calls `deps.stopDaemon` or compares revisions/digests: `stripAutoBounceFlag`, `dispatchRevisionMismatch`, `guardWorkDispatch`, `revisionMismatchMessage`, and `advanceLoadedRevision` no longer exist.
- [x] `jarvis daemon stop` and `jarvis daemon start` still work; existing `v2/src/commands/daemon.test.ts` lifecycle tests stay green.
- [x] Auto-start behavior is preserved: existing `connectWithAutoStart` tests in `v2/src/cli/stale-dispatch.test.ts` stay green.
- [x] Inverting any conditional this change adds or modifies (the `DaemonAlreadyRunningError` reuse branch and the deadline break in `connectWithAutoStart`, the `status` result parsing in `v2/src/daemon/daemon.ts`) fails at least one test.

## Documentation updates

- `v2/docs/write-behavior.md` — drop the pre-dispatch `status` comparison, bounce/retry, and `--no-auto-bounce` paragraph; keep the keyed-daemon auto-start paragraph and remove its `--no-auto-bounce` clause.
- `v2/docs/operator-runbook.md` — remove the "Bounce the daemon only when a merge changes executable code" guidance and the mismatch-bounce trap under orphaned-run recovery.
- `v2/docs/daemon-host.md` — remove the optional `status` guard params and the `loadedRevision` in-process advance from the RPC table.
- `v2/docs/v1-behaviors.md` — record that mutating dispatch is keyed-daemon only: no revision comparison, no bounce, no `--no-auto-bounce`, and that merges to executable code no longer block dispatch.
