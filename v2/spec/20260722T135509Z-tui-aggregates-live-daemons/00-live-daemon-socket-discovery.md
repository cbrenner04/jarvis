# 00 - Live daemon socket discovery

## Problem

Daemon socket paths are keyed by executable digest (`daemonPathsByDigest`, `v2/src/paths.ts`), but nothing enumerates them. Every caller connects to the one socket for its own digest, so overlapping daemons are invisible.

## Decisions

- Discovery enumerates `daemon-<key>.sock` entries directly under jarvis home; rules out reading PID files or a registry file, which drift from the sockets that actually answer.
- A socket counts as live only when a `health` RPC succeeds within a short probe timeout; rules out treating a leftover socket inode as a live daemon.
- Discovery returns socket paths sorted lexicographically; rules out filesystem-order results, which make downstream ownership tie-breaks nondeterministic.
- A probe or directory-read failure yields an empty/short result rather than throwing; rules out a missing `~/.jarvis` or one dead socket aborting the whole sweep.
- Discovery is a plain async function over an injectable prober and home directory; rules out a background-caching service with no current consumer.

## Task checklist

- [ ] Add live-daemon socket discovery under `v2/src/daemon/`, keyed off `jarvisHome()` and the `daemon-<key>.sock` name form.
- [ ] Probe each candidate socket for `health` liveness with an injectable connect seam and timeout.
- [ ] Unit tests over a temp jarvis home: live sockets returned sorted, non-socket and non-matching files ignored, dead sockets excluded, missing home returns empty.

## Acceptance criteria

- [ ] Discovery returns exactly the digest-keyed sockets whose daemon answers `health`, in a stable sorted order.
- [ ] A stale socket file that does not answer `health` is excluded from the result.
- [ ] Files in jarvis home that do not match the digest-keyed socket name form (including `daemon.pid`, `daemon-<key>.pid`, `daemon-<key>.log`, `config.json`) are never probed or returned.
- [ ] A missing jarvis home directory yields an empty result instead of an error.
- [ ] New tests for the above fail against the pre-fix code (no discovery entry point exists) and pass after the change.
- [ ] Inverting each added guard (liveness filter, name-form filter, missing-directory guard) makes at least one test fail; the liveness and name-form negative cases prove excluded paths are absent from the result, not merely reordered.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — under § Socket path, document discovery of live digest-keyed sockets as the boundary observers use to find coexisting daemons, including the health-probe liveness rule.
