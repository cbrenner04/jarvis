# 00 - Redirect daemon stdio to a rotating process log

`startDaemon` (`v2/src/daemon/daemon-lifecycle.ts`) spawns the detached child with
`stdio: "ignore"`, so process-level exceptions, spawn failures, and harness stderr
vanish after detach. Redirect the child's stdout and stderr to a bounded rotating
file so post-mortem evidence survives.

## Decisions

- Capture at spawn in `startDaemon` by passing an append-opened fd as the child's stdout/stderr — rules out having the detached child reopen its own fds.
- stdin stays `"ignore"`.
- `startDaemon` takes an optional `logPath`; when omitted, stdio stays `"ignore"` — rules out a library-level production default, matching the existing "callers supply paths" contract for `socketPath`/`pidPath`.
- The CLI (`v2/src/paths.ts`, `v2/src/cli.ts`) is the first consumer and pins `~/.jarvis/daemon.log` alongside `daemon.sock`/`daemon.pid`. The CLI's injected deps struct carries `logPath`, defaulting to `DAEMON_LOG_PATH`, and threads it into `startDaemon` — keeps the path injectable for tests.
- Rotation is checked at spawn time only. `daemon.log` carries process-level output alone — uncaught exceptions, spawn failures, stray harness stderr — because run and agent output flows through the persisted log store and the log-server stream path. That is kilobyte-scale per daemon lifetime, so a spawn-time bound is sufficient. Rules out in-daemon SIGHUP reopen, a writer/pipe supervisor process, and child self-rotation on a size check. Consequence: one long-lived daemon can grow its log past the cap; the bound holds across restarts.
- Byte cap 5 MiB, overridable via a `startDaemon` option — the rotation test is the first consumer and would otherwise have to write 5 MiB. Exactly one retained rotated file (`daemon.log.1`), not configurable — no caller needs a count knob.
- Ordering: rotation is checked and the log fd opened *before* `spawn()`; the parent closes its copy of the fd once the child owns it — a leaked fd is a real regression surface because the lifecycle tests call `startDaemon` repeatedly in-process.
- A missing log directory throws, matching `startDaemon`'s existing behavior for a missing pid-file directory; an unwritable log path throws before spawn rather than silently degrading to `"ignore"` — rules out a silent no-capture mode the operator cannot detect, and rules out orphaning a daemon whose log failed to open.

## Task checklist

- [ ] Add `logPath` and the byte-cap option to `startDaemon`; open the append fd and pass it as child stdout/stderr, then close the parent's copy.
- [ ] Rotate at spawn (before opening the fd) when the existing log is at/over the cap: rename to `<logPath>.1`, replacing any prior `.1`.
- [ ] Pin `DAEMON_LOG_PATH` in `v2/src/paths.ts`; add `logPath` to the CLI daemon deps struct (defaulting to `DAEMON_LOG_PATH`) and thread it into `startDaemon`.
- [ ] Tests in `v2/src/daemon/daemon-lifecycle.test.ts` (or a sibling) covering capture, append-across-restart, rotation, the no-`logPath` default, and the unwritable/missing-directory throw.
- [ ] Document the on-disk path, the process-log-vs-run-log boundary, and the rotation contract in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [ ] A daemon started with `logPath` writes its child stdout and stderr to that file; output written by the child after detach is readable in the file.
- [ ] Restarting a daemon whose `logPath` is under the byte cap appends: the prior daemon's output is still present alongside the new daemon's.
- [ ] Starting a daemon whose `logPath` is at or over the byte cap renames the existing file to `<logPath>.1` — replacing any prior `.1` — and starts a fresh log.
- [ ] `startDaemon` without `logPath` keeps the existing discard behavior (no file created).
- [ ] `startDaemon` with a `logPath` whose directory does not exist, or which cannot be opened for writing, throws and spawns no daemon.
- [ ] The CLI daemon deps struct exposes `logPath` defaulting to `DAEMON_LOG_PATH` (`~/.jarvis/daemon.log`), and `daemon start` passes it to `startDaemon`.
- [ ] Existing `daemon-lifecycle.test.ts` double-start, readiness, stop, and status tests stay green (capture is additive).

## Documentation updates

- [ ] `v2/docs/daemon-host.md` — `startDaemon` section documents `logPath`, the `~/.jarvis/daemon.log` consumer-layer path, the boundary between `daemon.log` (process-level stdio) and run/agent logs (log store + log-server stream), the spawn-time rotation contract (cap, single `.1`) with the "one long run may exceed the cap" consequence, and the caveat that concurrent daemons sharing one `logPath` are unsupported (double-start protection covers the real case).
