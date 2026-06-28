---
name: cross-process-log-follow-wake
---

# Cross-process log follow wake

Make the log reader's `follow` wake a detached client process when the daemon appends new events for that run. Closes the deferred cross-process wake item from structured log stream planning so IPC log tail and later completion wait can push instead of poll.

## Scope

- Cross-process notification on new log appends for a `runId` while a client holds `follow`.
- Preserve existing replay-from-seq-1 semantics and `AbortSignal` shutdown.
- Prove wake with a detached reader process against a daemon writer on shared storage.
- Apply the same wake path to daemon IPC log tail streams backed by `follow`.

## Out of scope

- `wait` RPC or completion-specific subscription logic.
- CLI commands.
- Generic pub/sub, filtered subscriptions, or non-log event buses.
- Log retention, rotation, or storage medium changes.

## Decisions

- Wake on append to shared storage, not in-process-only callbacks — rules out reusing Phase 3 in-process proofs as sufficient for detached CLI consumers.
- `follow` replay-then-block contract unchanged — rules out snapshot-only tail that skips live appends after attach.
- Single `runId` follow scope only — rules out multiplexed cross-run wake in this slice.
- Deferred to first consumer: exact OS notification primitive (poll interval, file watch, etc.) — pin in refine when implementation chooses storage layout.

## Documentation updates

- `v2/docs/v2-architecture.md` — Observability: record that cross-process `follow` wake is settled and how detached clients receive live appends.
- Reconcile the structured log stream deferral note once the behavior ships.

## Prerequisites

- Structured log stream exposes `follow(runId, signal)` with replay then block-for-append semantics.
- Daemon appends structured log events for hosted runs during execution.
- Daemon serves run log tail over the IPC streaming channel backed by `follow`.
