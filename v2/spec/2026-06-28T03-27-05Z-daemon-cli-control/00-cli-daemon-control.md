# 00 - CLI daemon control surface

Add the minimal operator CLI over the daemon IPC surface. The current v2 CLI
only hosts foreground `jarvis write`; the daemon APIs already exist behind
programmatic lifecycle helpers and IPC methods. This slice makes the CLI a thin
client for those APIs without moving orchestration into argument parsing.

## Decisions

- Use `jarvis daemon start|stop|status` for daemon lifecycle - rules out top-level `jarvis start|stop|status`, which would collide with future workflow/router verbs.
- Use `jarvis run start|list|log|pause|resume|kill` for run control - rules out daemon-scoped run verbs such as `jarvis daemon run start`, keeping lifecycle and run-control namespaces separate.
- `v2/docs/write-behavior.md` is the durable operator CLI home - rules out documenting daemon CLI behavior in `v2/docs/daemon-host.md`, which owns wire/lifecycle contracts only.
- The production CLI uses `~/.jarvis/daemon.sock` and `~/.jarvis/daemon.pid` - rules out leaving socket/PID defaults to each caller now that this slice is the first production consumer.
- `jarvis run start` accepts the same required flags as `jarvis write` (`--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--agents`, `--max-iterations`) and maps them to `WriteLoopInput` identically - rules out a daemon-only launch schema before workflows/config land.
- `jarvis run log` prints one JSON line per daemon `PersistedRecord` after replaying persisted records and then following new records - rules out raw IPC frames, pretty JSON, and direct log-file reads.
- CLI commands pass daemon error codes/messages through tersely - rules out reclassifying run guards or retryability locally.

## Operator contract

- Daemon paths: commands use `~/.jarvis/daemon.sock` and `~/.jarvis/daemon.pid` unless tests inject paths.
- `daemon start`: exit 0 and print `{pid, socketPath}` on success; if the daemon is already running, exit 1 and print the lifecycle error name/message to stderr.
- `daemon stop`: exit 0 when `stopDaemon` completes, including already-stopped/no-pid cases accepted by the lifecycle helper.
- `daemon status`: print `running` and exit 0 when the lifecycle probe returns running; print `stopped` and exit 1 otherwise.
- Run IPC unavailable: run-control commands exit 1 and print the connection error to stderr.
- Run RPC errors: print `<code>: <message>` to stderr and exit 1 for `invalid_params`, `unknown_run`, `run_not_active`, `terminal_run`, `run_in_progress`, and `worktree_claimed`.
- Run RPC success: print a terse success line or daemon result to stdout and exit 0.

## Tasks

- Add CLI parsing for `daemon start`, `daemon stop`, `daemon status`, `run start`, `run list`, `run log`, `run pause`, `run resume`, and `run kill`.
- Wire daemon lifecycle commands to `startDaemon`, `stopDaemon`, and `getDaemonStatus` through injectable dependencies.
- Wire run commands to the existing IPC request/response methods and stream channel through an injectable IPC client.
- Map `run start` arguments to `WriteLoopInput` using the `jarvis write` flag contract; do not invoke `executeWriteLoop` directly on the daemon path.
- Implement `run log <run-id>` by opening the daemon stream, writing each record payload as compact JSONL in arrival order, and stopping on stream end or client close.
- Preserve existing `jarvis write` behavior and exit-code mapping.
- Co-locate CLI tests that inject lifecycle and IPC fakes, including success and pass-through error paths.
- Update `v2/docs/write-behavior.md` with the operator command table, path defaults, input mapping, output/error contract, and log JSONL behavior.
- Update `v2/docs/daemon-host.md` only to cross-link operator CLI behavior and clarify that the CLI supplies production socket/PID defaults while the transport library still requires explicit paths.

## Acceptance criteria

- [ ] `jarvis daemon start` uses `~/.jarvis/daemon.sock` and `~/.jarvis/daemon.pid`, starts the detached daemon through the lifecycle helper, prints `{pid, socketPath}`, and does not invoke write-loop code.
- [ ] `jarvis daemon start` exits 1 and prints the lifecycle error name/message when the helper reports an already-running daemon.
- [ ] `jarvis daemon stop` uses the production socket/PID paths, calls the lifecycle helper once, exits 0 when it completes, and treats helper-accepted already-stopped/no-pid cases as success.
- [ ] `jarvis daemon status` reports `running` with exit 0 or `stopped` with exit 1 from the lifecycle status probe.
- [ ] `jarvis run start ...` accepts the `jarvis write` flag set, sends one IPC `start` request carrying the matching `WriteLoopInput`, prints the returned run ID, and does not call `executeWriteLoop` locally.
- [ ] `jarvis run start ...` exits 1 and prints daemon `run_in_progress` or `worktree_claimed` errors as `<code>: <message>` without local guard logic.
- [ ] `jarvis run list` sends one IPC `list` request and prints the daemon's run rows with run ID, project, branch, status, and liveness.
- [ ] `jarvis run log <run-id>` opens the daemon stream, prints replayed persisted records before followed records as compact JSONL, preserves arrival order, and does not read log files directly.
- [ ] `jarvis run pause <run-id>` sends one IPC `pause` request, reports daemon success, and passes through `unknown_run` and `run_not_active` errors as `<code>: <message>`.
- [ ] `jarvis run resume <run-id>` sends one IPC `resume` request, reports daemon success, and passes through `unknown_run`, `terminal_run`, `run_in_progress`, and `worktree_claimed` errors as `<code>: <message>`.
- [ ] `jarvis run kill <run-id>` sends one IPC `kill` request, reports daemon success, and passes through `unknown_run` and `run_not_active` errors as `<code>: <message>`.
- [ ] Run-control commands exit 1 and print a terse connection error when the daemon socket is unavailable.
- [ ] Existing `v2/src/cli.test.ts` coverage for `jarvis write` stays green.
- [ ] New CLI tests cover lifecycle commands, run-control success paths, stream replay/follow JSONL output, unavailable-daemon errors, and daemon error pass-through with injected fakes.
- [ ] `v2/docs/write-behavior.md` documents the daemon CLI command surface, socket/PID defaults, start-input mapping, exit/error contract, and log JSONL behavior.
- [ ] `v2/docs/daemon-host.md` remains scoped to IPC/lifecycle contracts and points operator CLI readers to `v2/docs/write-behavior.md`.
