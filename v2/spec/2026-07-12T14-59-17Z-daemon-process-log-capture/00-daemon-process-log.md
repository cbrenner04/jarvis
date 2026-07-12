# 00 - Redirect daemon stdio to a rotating process log

`startDaemon` (`v2/src/daemon/daemon-lifecycle.ts`) spawns the detached child with
`stdio: "ignore"`, so process-level exceptions, spawn failures, and harness stderr
vanish after detach. Redirect the child's stdout and stderr to a bounded rotating
file so post-mortem evidence survives.

## Decisions

- Capture at spawn in `startDaemon` by passing an appended-open fd as the child's stdout/stderr — rules out having the detached child reopen its own fds.
- `startDaemon` takes an optional `logPath`; when omitted, stdio stays `"ignore"` — rules out a library-level production default, matching the existing "callers supply paths" contract for `socketPath`/`pidPath`.
- The CLI (`v2/src/paths.ts`, `v2/src/cli.ts`) is the first consumer and pins `~/.jarvis/daemon.log` — alongside `daemon.sock`/`daemon.pid`.
- Rotation is checked at spawn time only: if the existing log is at or over the byte cap, it is renamed to `<logPath>.1` (replacing any prior `.1`) before the new fd is opened. Rules out mid-run rotation, which the inherited-fd design cannot do without the child reopening. Consequence: one long-lived daemon can grow its log past the cap; the bound holds across restarts.
- Byte cap 5 MiB, one retained rotated file (`daemon.log.1`), both overridable via `startDaemon` options — resolves the intent's "deferred to first consumer" now that the CLI is that consumer.
- A missing log directory is created; an unwritable log path fails the spawn rather than silently degrading to `"ignore"` — rules out a silent no-capture mode the operator cannot detect.

## Task checklist

- [ ] Add `logPath`, and rotation cap options, to `startDaemon`; open append fd and pass it as child stdout/stderr.
- [ ] Rotate at spawn when the existing log is at/over the cap.
- [ ] Pin `DAEMON_LOG_PATH` in `v2/src/paths.ts` and pass it from the CLI `daemon start` path.
- [ ] Tests in `v2/src/daemon/daemon-lifecycle.test.ts` (or a sibling) covering capture, rotation, and the no-`logPath` default.
- [ ] Document the on-disk path and rotation contract in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [ ] A daemon started with `logPath` writes its child stdout and stderr to that file; output written by the child after detach is readable in the file.
- [ ] Starting a daemon whose `logPath` already exceeds the byte cap renames the existing file to `<logPath>.1` and starts a fresh log; only the current file plus one rotated file remain.
- [ ] `startDaemon` without `logPath` keeps the existing discard behavior (no file created).
- [ ] `startDaemon` with a `logPath` under a directory that does not exist creates it; an unwritable `logPath` throws instead of spawning a capture-less daemon.
- [ ] `jarvis daemon start` from the CLI captures daemon stdout/stderr to `~/.jarvis/daemon.log`.
- [ ] Existing `daemon-lifecycle.test.ts` double-start, readiness, stop, and status tests stay green (capture is additive).

## Documentation updates

- [ ] `v2/docs/daemon-host.md` — `startDaemon` section documents `logPath`, the `~/.jarvis/daemon.log` consumer-layer path, the spawn-time rotation contract (cap, `.1` retention), and the "one long run may exceed the cap" consequence.
