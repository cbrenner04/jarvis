# 00 - CLI daemon control surface

Add the minimal operator CLI over the daemon IPC surface. The current v2 CLI
only hosts foreground `jarvis write`; the daemon APIs already exist behind
programmatic lifecycle helpers and IPC methods. This slice makes the CLI a thin
client for those APIs without moving orchestration into argument parsing.

## Decisions

- Use `jarvis daemon start|stop|status` for daemon lifecycle - rules out top-level `jarvis start|stop|status`, which would collide with future workflow/router verbs.
- Use `jarvis run start|list|log|pause|resume|kill` for run control - rules out daemon-scoped run verbs such as `jarvis daemon run start`, keeping lifecycle and run-control namespaces separate.
- `jarvis run log` tails the daemon IPC stream until stream end or client close - rules out reading the log file directly from the CLI.
- CLI commands pass daemon error codes/messages through tersely - rules out reclassifying run guards or retryability locally.

## Tasks

- Add CLI parsing for `daemon start`, `daemon stop`, `daemon status`, `run start`, `run list`, `run log`, `run pause`, `run resume`, and `run kill`.
- Wire daemon lifecycle commands to `startDaemon`, `stopDaemon`, and `getDaemonStatus` through injectable dependencies.
- Wire run commands to the existing IPC request/response methods and stream channel through an injectable IPC client.
- Reuse the existing write-loop input parsing for `run start` where practical; do not invoke `executeWriteLoop` directly on the daemon path.
- Preserve existing `jarvis write` behavior and exit-code mapping.
- Co-locate CLI tests that inject lifecycle and IPC fakes; add a stream-tail test for `run log`.
- Update `v2/docs/daemon-host.md` with the operator command table and any pinned socket/PID path behavior needed by the CLI.

## Acceptance criteria

- [ ] `jarvis daemon start` starts the detached daemon through the lifecycle helper and prints socket metadata without invoking write-loop code.
- [ ] `jarvis daemon stop` stops the daemon through the lifecycle helper and reports success when the helper completes.
- [ ] `jarvis daemon status` reports running vs stopped from the lifecycle status probe and exits nonzero when stopped.
- [ ] `jarvis run start ...` sends one IPC `start` request carrying `WriteLoopInput`, prints the returned run ID, and does not call `executeWriteLoop` locally.
- [ ] `jarvis run list` sends one IPC `list` request and prints the daemon's run rows with run ID, project, branch, status, and liveness.
- [ ] `jarvis run log <run-id>` opens the IPC stream for that run and writes streamed structured records to stdout in arrival order.
- [ ] `jarvis run pause|resume|kill <run-id>` sends the matching IPC request, reports daemon success, and propagates daemon errors without local guard logic.
- [ ] Existing `v2/src/cli.test.ts` coverage for `jarvis write` stays green.
- [ ] New CLI tests cover lifecycle commands and run-control commands with injected fakes.
- [ ] `v2/docs/daemon-host.md` documents the CLI command surface and socket/PID path behavior shipped by this slice.
