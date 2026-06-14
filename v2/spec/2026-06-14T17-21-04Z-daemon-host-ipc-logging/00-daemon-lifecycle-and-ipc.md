# 00 - Daemon lifecycle and IPC

Add the daemon as a second host, not a rewrite of `executeWriteLoop`: a
long-lived process with a local request/response API and a thin CLI client for
lifecycle/status. No run execution yet.

## Decisions

- Use a Unix-domain socket at `~/.jarvis/daemon.sock` on POSIX. Rules out TCP
  localhost, which adds port discovery and remote-access semantics this local
  daemon does not need.
- Use newline-delimited JSON frames with `{id, method, params}` requests and
  `{id, ok, result|error}` responses. Rules out a custom binary/RPC dependency
  before any client needs it.
- Stream responses use the same socket as tagged NDJSON frames with one
  terminal response frame. Rules out a second socket per stream.
- Treat a live socket that answers `status` as the single-instance guard; stale
  socket files are removed before bind. Rules out PID-file ownership as the
  primary guard.
- CLI autostarts the daemon only for run-control commands after this subspec's
  lifecycle commands exist. Rules out requiring an always-manual daemon start for
  later thin clients.

Deferred to first consumer: authentication/authorization for IPC - pin when a
non-local or multi-user caller exists.

## Task checklist

- [ ] Add daemon host modules under `v2/src` (for example `daemon/server.ts`,
  `daemon/client.ts`, `daemon/protocol.ts`) with exported contracts documented.
- [ ] Bootstrap `~/.jarvis/` and bind `~/.jarvis/daemon.sock`; tests use temp
  paths and write nothing under `~/.jarvis`.
- [ ] Implement NDJSON request/response framing with parse/error handling and
  request IDs.
- [ ] Implement daemon methods: `status` and `stop`.
- [ ] Add CLI commands: `daemon start`, `daemon stop`, `daemon status`.
- [ ] Keep `jarvis write` available as the foreground path until detached runs
  land in 02.
- [ ] Co-located protocol/server/client/CLI tests.

## Acceptance criteria

- [ ] `jarvis daemon start` starts a long-lived host that accepts `status` over
  the Unix socket (test with temp socket).
- [ ] `jarvis daemon status` reports whether the daemon is reachable without
  starting a run (test).
- [ ] `jarvis daemon stop` asks the daemon to exit and removes or tolerates the
  stale socket on the next start (test).
- [ ] A second daemon start against a live socket fails cleanly without replacing
  the running daemon (test).
- [ ] Malformed JSON, unknown methods, and handler errors return structured
  error responses and keep the daemon alive (test).
- [ ] Protocol/client tests prove request IDs match responses.
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] New `v2/docs/daemon.md`: daemon role, socket path, lifecycle commands,
  NDJSON frame shape, single-instance rule, and that CLI/TUI are clients over
  IPC.
- [ ] `v2/docs/write-behavior.md`: note `jarvis write` remains the foreground
  host until detached `start` lands.
- [ ] `v2/docs/v1-behaviors.md`: no change - additive v2-only host.
