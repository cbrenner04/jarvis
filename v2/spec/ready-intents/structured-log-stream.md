---
name: structured-log-stream
---

# Structured log stream for v2 runs

Stand up the structured, queryable log-event model the daemon and later surfaces consume. The write loop emits boundary/iteration events into a sink; a reader supports tail/follow keyed by run ID. Not free-text lines — the event shape is the load-bearing interface.

Source: Phase 3 scope (1) in `v2/spec/seeds/phase-3-daemon-host.md`; logging posture in `v2/docs/v2-architecture.md` (Interface). Done condition is merged code in `v2/src`, not this intent.

## What exists today

- `executeWriteLoop` (`v2/src/write-loop.ts`) persists run/attempt rows via the state store; no structured log stream.
- Architecture calls logging "improve later"; this intent settles the first event shape.

## Scope

- Typed log-event model: structured fields, queryable, keyed by run ID.
- Sink the run path writes to during loop execution (boundary/iteration events at minimum).
- Reader API: tail and follow a run's event stream.
- Wire `executeWriteLoop` to emit its boundary/iteration events into the sink.
- Exercise via injected test bindings; no real agent bindings required.

## Out of scope

- Daemon host, IPC, run-control API, CLI client (sibling intents).
- TUI, workflow runner, PR lifecycle, concurrency/queue, richer steering.

## Decisions

- Event shape is structured records, not printf-style lines — rules out mirroring v1 stderr as the contract.
- Run ID is the primary query key — rules out project-only or global undifferentiated logs.
- Write loop emits into the sink directly; no separate log-agent — rules out an agent subprocess for logging.
- Reader exposes tail/follow only; no ad-hoc query language in this slice — rules out SQL/generic search surface ahead of a consumer.
- Deferred to first consumer: on-disk retention, rotation, and compaction policy — pin when daemon or TUI needs it.
- Deferred to first consumer: exact sink medium (append-only file vs. SQLite table vs. hybrid) — pin in refine; tests use injectable/temp paths.

## Documentation updates

- `v2/docs/v2-architecture.md` — replace "logs need improvement, but later" with the settled event shape and tail/follow contract.

## Prerequisites

- Resumable write loop with durable SQLite state and kill/crash resume over a dirty worktree (`executeWriteLoop`, state store)
