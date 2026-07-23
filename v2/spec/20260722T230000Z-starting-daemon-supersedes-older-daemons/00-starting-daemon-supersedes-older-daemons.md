# 01 - A starting daemon supersedes older live daemons

## Problem

After `00` a daemon can retire, but nothing tells it to. Daemons are keyed by executable digest (`daemonPathsByDigest`, `v2/src/paths.ts`), so rebuilding moves dispatch to a new socket while the old daemon keeps admitting work from anything still pointing at it.

## Decisions

- The new daemon sends `supersede`, in `startDaemonRuntime` after its own IPC server is listening; rules out sending from the CLI-side `startDaemon` spawner, which is not the only start path and cannot observe readiness.
- Candidates are `daemon-<key>.sock` entries under `jarvisHome()` excluding the daemon's own `socketPath`; rules out PID files or a registry, which drift from the sockets that answer.
- No liveness probe: connect, send `supersede`, ignore any connect/RPC failure; a dead socket simply fails; rules out a health-probe pass, which adds a round trip for the same outcome.
- Sends happen best-effort and never fail startup; one unreachable peer does not stop the others or abort boot; rules out awaiting a successful ack from every peer.
- The candidate enumeration and connect path are injectable seams on `DaemonStartupDeps`; rules out reaching the real filesystem and real sockets in unit tests.
- Sending is fire-and-forget with respect to run admission: the new daemon starts serving immediately and does not wait for peers to retire; rules out a startup barrier, which would stall dispatch behind another daemon's in-flight runs.

## Task checklist

- [ ] Enumerate other digest-keyed sockets in jarvis home and send `supersede` to each at startup, behind injectable seams.
- [ ] Tolerate missing home directory, non-matching filenames, and unreachable sockets.
- [ ] Tests in `v2/src/daemon/daemon-lifecycle.test.ts`: peers receive `supersede`, own socket is excluded, non-matching files are never connected to, a failing peer does not prevent the other send or startup.

## Acceptance criteria

- [ ] Starting a daemon sends `supersede` to every other digest-keyed socket in jarvis home and never to its own.
- [ ] Files in jarvis home that are not `daemon-<key>.sock` (including `daemon-<key>.pid`, `daemon-<key>.log`, `config.json`) are never connected to.
- [ ] A peer that cannot be reached, or that errors on `supersede`, leaves the remaining peers superseded and the new daemon fully started and serving.
- [ ] A missing jarvis home directory leaves startup unaffected.
- [ ] The sends do not gate admission: the new daemon answers `start` without waiting for peers to exit.
- [ ] New tests in `v2/src/daemon/daemon-lifecycle.test.ts` covering the above fail against the pre-fix code (startup contacts no other socket) and pass after the change.
- [ ] Inverting each added guard (own-socket exclusion, socket-name filter, per-peer failure tolerance) makes at least one test fail; the exclusion and name-filter negative cases assert the excluded paths were never connected to.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Socket path: starting a daemon supersedes the other keyed sockets, best-effort and non-blocking.
- `v2/docs/operator-runbook.md` — overlapping daemons after a rebuild: the old daemon stops taking work and disappears on its own once its runs finish; no stop command needed.
- `v2/docs/v1-behaviors.md` — record that starting a daemon retires older keyed daemons.
