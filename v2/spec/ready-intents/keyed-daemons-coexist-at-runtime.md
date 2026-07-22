---
name: keyed-daemons-coexist-at-runtime
---

# Keyed daemons coexist at runtime

## Problem

- Digest-keyed paths are resolved, but nothing proves two daemons with different digests actually run at once over real sockets without observing each other's runs.

## Outcome

- Two daemons started under different executable digests are simultaneously live over real sockets, with disjoint socket, PID, and process-log paths.
- Observation is scoped: a run on one daemon is invisible to `run list` and `run wait` from the other.

## Decisions

- Drive real daemon processes over real sockets; rules out asserting path strings as a substitute for coexistence.
- Place the test in a `.sandbox-unrunnable.test.ts` file and the `test:integration:v2` scope; rules out adding real-process timing to the agent-runnable suite.
- Reap both daemons unconditionally, including on failure and timeout; rules out leaked daemons across test runs.
- Use temporary isolated home directories, not the operator's `~/.jarvis`; rules out any interaction with the operator's daemon.

## Acceptance criteria

- [ ] Two daemons keyed by different digests are live at the same time, with disjoint socket, PID, and process-log paths and no lifecycle error from the second start.
- [ ] With a run present on only one daemon, `run list` from the other returns no rows for it and `run wait` from the other does not resolve against it.
- [ ] The test fails against fixed-socket code, where the second start collides on the shared socket and PID.
- [ ] Neither daemon survives the test, on success or failure.
- [ ] `bun run typecheck` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — concurrently keyed daemons do not share socket, PID, or log paths, and observation is scoped to the selected daemon.

## Prerequisites

- Daemon socket, PID, and process-log paths are keyed by the invoking executable-tree digest.
