---
name: dispatch-starts-or-reuses-the-keyed-daemon
---

# Dispatch starts or reuses the keyed daemon

## Problem

- With daemons keyed by digest, a CLI whose daemon is not running has nothing to connect to, and two CLIs starting the same keyed daemon race for its PID lease.

## Outcome

- Mutating dispatch starts the matching daemon when absent, reuses it when present, and proceeds while a differently keyed daemon owns live runs.
- Losing the concurrent-start race is normal: the loser connects to the winner rather than failing.

## Decisions

- Auto-start only the daemon matching the invoking digest, then reuse it; rules out an operator pre-start requirement and rules out replacing another digest's daemon.
- Treat `DaemonAlreadyRunningError` from the PID lease as "someone else won, connect to them"; rules out surfacing the race as a dispatch failure.
- Propagate every non-race start error unchanged; rules out swallowing real lifecycle failures into the race path.
- Bound the post-race connect attempt with injectable time; rules out an unbounded wait and rules out a real-clock sleep in tests.

## Acceptance criteria

- [ ] Dispatch with no matching daemon starts one and proceeds.
- [ ] Dispatch with a matching daemon already running reuses it and starts nothing.
- [ ] Dispatch proceeds while a daemon keyed by a different digest owns live runs.
- [ ] A start that loses the PID-lease race (`EEXIST`) connects to the winner and dispatches; any other start error propagates unchanged.
- [ ] A regression test proves the race path, and fails against code that treats the race as an error.

## Documentation updates

- `v2/docs/write-behavior.md` — automatic start-or-reuse and race semantics.

## Prerequisites

- Daemon sockets, PID files, and process logs are keyed by executable digest.
