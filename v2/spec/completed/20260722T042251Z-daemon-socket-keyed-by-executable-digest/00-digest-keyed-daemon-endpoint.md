# Digest-keyed daemon endpoint

`v2/src/paths.ts` pins one fixed `daemon.sock`/`daemon.pid`/`daemon.log`, so a CLI built from one executable tree reaches whatever daemon holds that socket and can only detect the mismatch after connecting (`dispatchRevisionMismatch`).

## Decisions

- Derive socket, PID, and process-log basenames from `getExecutableTreeDigest`; rules out Git revision or a second compatibility identity.
- Use a fixed-width leading slice of the digest (16 hex chars) in the basename, not the full 64; the macOS `sun_path` limit is 104 bytes and `~/.jarvis/daemon-<64hex>.sock` overflows it under a typical home path. Rules out full-digest basenames and a hashed second identity.
- Resolve the keyed paths in `main()` before `createRuntimeDeps`, and let explicitly injected `socketPath`/`pidPath`/`logPath` win; rules out probing a fixed socket and negotiating through `status`, and keeps existing test injection working.
- Resolve the key from the injected `getExecutableDigest` dep when present, falling back to `getInvokingExecutableDigest`; rules out a second, untestable digest seam and lets a test stand up two differently keyed CLIs.
- Memoize the invoking executable digest per process; rules out one `git ls-tree` pair per daemon-touching call site.
- Remove the legacy `DAEMON_SOCKET_PATH` fallback default from `tui-daemon-client` and `tui-log-tail-client`; rules out a silent connect to the legacy socket when a caller omits the path.
- Keep the legacy `daemon.sock`/`daemon.pid`/`daemon.log` constants and any daemon serving them untouched; rules out migration probes, stops, replacement, or cleanup.

## Tasks

- Add digest-keyed path builders to `v2/src/paths.ts` and a resolver that turns the invoking executable digest into the daemon socket/PID/log triple.
- Wire `v2/src/cli.ts` to resolve that triple once and pass it into `createRuntimeDeps`, so `daemon start|stop|status|log`, `run` dispatch/list/wait, `tui`, `cleanup`, and stale-dispatch restart all use it.
- Require an explicit socket path in the TUI daemon and log-tail clients.
- Align daemon and operator documentation.

## Acceptance criteria

- [x] `jarvis daemon start|stop|status`, `run` dispatch, `run list`, `run wait`, `tui`, and `cleanup` connect to `~/.jarvis/daemon-<key>.sock`, where `<key>` derives from the invoking executable tree digest, and start/stop use the matching PID and process-log paths.
- [x] A live daemon on a differently keyed socket, and a live daemon on the legacy `~/.jarvis/daemon.sock`, receive no request from the invoking CLI.
- [x] Connecting with no explicit socket path is impossible in the TUI daemon and log-tail clients: the path is a required argument.
- [x] A regression test drives CLI daemon-touching commands with a stub connector, asserts the requested path is the digest-keyed one and is neither the legacy path nor a differently keyed path, and fails against the pre-change fixed-socket code.
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; the injected-path-wins branch and the resolve-from-digest branch are each pinned, and the negative case proves no connection is opened on the legacy path.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — digest-keyed socket, PID, and process-log paths; CLI defaults are no longer fixed.
- `v2/docs/write-behavior.md` — daemon and TUI socket/PID/log defaults.
- `v2/docs/v2-architecture.md` — production socket and PID defaults are keyed, not fixed.
- `v2/docs/operator-runbook.md` — where to find the socket and process log for the daemon a given checkout selects.
