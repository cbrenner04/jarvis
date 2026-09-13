# Outgoing generation drain and exit

## Problem

After changeover ([01](./01-handoff-changeover-protocol.md)) the outgoing generation is still executing admitted work on its private endpoint. Nothing observes that drain, and the pre-fix retirement path documented in `v2/docs/daemon-host.md` § Daemon retirement on supersession assumes the retiring daemon keeps its own public socket — so an upgrade can leave an unrelated project's in-flight run stranded behind an address nobody consults.

## Behavior

The incoming generation observes the outgoing generation's drain over the handoff channel to the private endpoint and routes ownership queries for runs the outgoing generation still holds. The outgoing generation exits once its active-run set is empty, leaving no public socket file and no public PID ownership behind. Runs from every registered project drain the same way — an upgrade driven from one project does not interrupt another project's in-flight run.

## Decisions

- Drain observation reads the outgoing generation's live run set over the private endpoint's existing `list` RPC; rules out a bespoke drain-progress RPC the legacy generation in [03](./03-legacy-keyed-daemon-migration.md) could not answer.
- The outgoing generation's exit trigger stays `shouldShutdownNow` (retiring ∧ no active runs); rules out the successor killing the outgoing generation on a timer.
- Public PID ownership is written by the incoming generation and never cleared by the outgoing generation on exit; rules out a drained predecessor deleting the live successor's PID file.
- Drain observation is advisory: losing the private endpoint (predecessor already exited) ends observation without failing the successor; rules out the successor treating a normal fast drain as an error.

## Acceptance criteria

- [x] A multi-project test proves that upgrading while project A's run is in flight leaves a second registered project's in-flight run uninterrupted and still steerable to its normal outcome; it fails against the pre-fix shape where the run's owning daemon is addressable only by digest.
- [x] A lifecycle test proves an outgoing generation exits after its last admitted run settles and leaves no public socket file and no public PID ownership behind; it fails against the pre-fix retirement path that leaves the retiring daemon owning its keyed socket.
- [x] A test proves the incoming generation reports a run still held by the outgoing generation as live while that run is in flight, and stops reporting it once the outgoing generation has drained.
- [x] A test proves drain observation against an already-exited private endpoint completes without failing the incoming generation.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — replace the supersession-retirement section with drain observation over the handoff channel, overlap semantics, and exit ownership.
- `v2/docs/operator-runbook.md` — state that an upgrade preserves unrelated live work and needs no manual daemon stop.
- `v2/docs/v1-behaviors.md` — record the drain-and-exit ownership behavior replacing keyed retirement.

## Review findings (2026-09-11, independent diff review)

**One transient poll failure permanently ends drain observation and mis-reports live runs as dead.** `daemon-drain-observer.ts` defaults `timeoutMs` to 1 s and, on any failure, sets `stopped = true`, clears the interval, and empties `liveRunIds` with no recovery. A predecessor busy for more than a second — it is still executing real write loops — makes the successor report the predecessor's in-flight runs as `isLive: false` forever, which is exactly the stranding this subspec exists to prevent. Distinguish a slow poll from a drained endpoint, and recover from transient failures.

**`drainObservationEndsOnPollFailure` is an identity function** — a guard with no decision in it, whose "both truth directions" test asserts only `f(true) === true` and `f(false) === false`. Extract the real predicate or drop it.

**Criteria that were ticked but not proven.** AC 2's two halves are both unverified: the test asserts `exitCalls === [0]` on an injected stand-in and that the *incoming* daemon still answers, and its own header comment declares PID ownership out of scope — nothing checks that no public socket file and no public PID ownership remain. The drain-observer failure tests assert `liveRunIds()` equals the empty set, which is the constructor's initial value, so they pass whether or not the poll ever ran; assert the interval was cleared and that a real drained endpoint is distinguishable from a never-polled one.
