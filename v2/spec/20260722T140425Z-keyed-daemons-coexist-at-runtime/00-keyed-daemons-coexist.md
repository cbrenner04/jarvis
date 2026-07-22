# 00 - Two keyed daemons live at once over real sockets

## Problem

`daemonPathsByDigest` (`v2/src/paths.ts`) and its CLI wiring (`v2/src/cli.ts`) derive
socket, PID, and process-log paths from the invoking executable digest, but no test
starts two real daemons under different digests at the same time. Path-string assertions
do not prove the second `daemon start` avoids `DaemonAlreadyRunningError` and that both
processes stay live.

`v2/docs/daemon-host.md` additionally claims observation via `run list` / `run wait` is
scoped per daemon. That is false: run state is keyed by `JARVIS_HOME`
(`openStateStore` defaults to `<jarvisHome>/state/v2.sqlite`) and run rows carry no
digest column, so durable rows are shared across daemons under one home.

## Decisions

- Drive real daemon processes over real sockets via `cliMain(["daemon", "start"], io, { getExecutableDigest })` with two distinct digests; rules out asserting path strings from `daemonPathsByDigest` as a substitute for coexistence.
- Both daemons run under **one** shared temporary `JARVIS_HOME`; rules out two homes, under which disjointness holds trivially and the test cannot fail against fixed-socket code.
- Do not scope `run list` / `run wait` by digest, and do not add a digest column to run rows; filtering would hide a restarted daemon's own reconciled and auto-resumed rows, since any `v2/src/**` edit changes the digest.
- Correct `v2/docs/daemon-host.md` rather than implement to its current text.
- File is `*.sandbox-unrunnable.test.ts` under `v2/src/daemon/`, so `scripts/test-slice.ts` routes it to `test:integration:v2`; rules out putting real-process timing in the agent-runnable suite.
- Reap both daemon PIDs in an `afterEach` that reads PIDs captured at spawn time, not in an in-body `finally`; a per-test timeout skips the body but still runs `afterEach`. Rules out leaked daemons.
- Temporary home via `mkdtempSync`, never the operator's `~/.jarvis`; rules out touching the operator's daemon.
- Skip via `test.skipIf(!canUseUnixSockets())`, matching sibling daemon integration tests.

## Task checklist

- [ ] Add `v2/src/daemon/keyed-daemon-coexistence.sandbox-unrunnable.test.ts`: one shared temp `JARVIS_HOME`, two `daemon start` invocations under distinct digests, assertions on exit codes, path disjointness, and both processes live over their own sockets.
- [ ] Track and SIGKILL both daemon PIDs in `afterEach`; remove the temp home.
- [ ] Correct the keying paragraph in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [ ] `v2/src/daemon/keyed-daemon-coexistence.sandbox-unrunnable.test.ts` starts two daemons under distinct executable digests and one shared temporary home, and asserts both exit `0`, both PID files hold distinct live PIDs, both sockets answer a `status` request, and socket, PID, and process-log paths are pairwise disjoint.
- [ ] That test fails when digest keying is inverted — with `daemonPathsByDigest` returning the fixed `DAEMON_SOCKET_PATH` / `DAEMON_PID_PATH` / `DAEMON_LOG_PATH` values, the second start collides on the shared socket and PID and the test does not pass.
- [ ] Neither daemon process survives the test file, on pass, failure, or per-test timeout.
- [ ] `v2/docs/daemon-host.md` no longer claims `run list` / `run wait` observation is scoped by daemon, and states that durable run rows are shared across keyed daemons under one `JARVIS_HOME` while liveness and live controls are scoped to the owning daemon.
- [ ] `bun run typecheck` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — concurrently keyed daemons do not share socket, PID, or process-log paths; liveness and live controls are scoped to the owning daemon; durable run rows are shared under one home.
- `v2/docs/v1-behaviors.md` — not applicable: no existing v1 behavior changes.
