---
name: daemon-wait-run-completion
---

# Daemon wait for run completion

Add a `wait <runId>` run-control RPC that resolves when the run reaches a terminal boundary and returns the terminal outcome (`loop_finished` payload plus durable `runStatus`). Multiple concurrent waiters on the same run all resolve at the terminal edge; disconnect or client abort detaches without affecting the run or other waiters.

## Scope

- One-shot `wait` RPC keyed by a single `runId`.
- Resolve immediately from durable state when the run is already terminal.
- Block until terminal for in-progress runs using `loop_finished` plus durable status as the signal source.
- Support concurrent waiters; clean detach on client disconnect or `AbortSignal`.
- Additive run-control verb only — no changes to existing verb semantics or event shapes.

## Out of scope

- External delivery (webhooks, HTTP, push notifications).
- Subscribe-to-many, topic bus, or non-terminal event subscriptions.
- Concurrency admission or `queued` notifications.
- Core write loop or state-store schema changes.
- CLI surface.

## Decisions

- `wait` is a thin superset over existing terminal signals — rules out redefining `loop_finished` or run-control verbs.
- Terminal payload combines `loop_finished` fields with durable `runStatus` — rules out inventing a parallel outcome taxonomy.
- Already-terminal runs resolve immediately without blocking — rules out hanging on completed runs.
- Client disconnect aborts only that waiter — rules out cancelling the hosted run or other waiters.
- Deferred to first consumer: unknown-`runId` posture (empty vs explicit error) — pin in refine; must match log-reader/tail posture for the chosen variant.

## Documentation updates

- `v2/docs/v2-architecture.md` — Interface/Steering: record the `wait` verb, payload, and multi-waiter detach semantics.

## Prerequisites

- Cross-process `follow` wakes detached clients on new log appends.
- Structured log stream emits terminal `loop_finished` with `loopOutcomeKind`, `iterationsConsumed`, and `resumable`.
- State store runs rows carry durable terminal status.
- Daemon run-control typed IPC serves existing run verbs over Unix socket.
