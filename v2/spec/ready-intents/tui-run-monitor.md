---
name: tui-run-monitor
---

# TUI run monitor and outcome

Operator lists runs, sees live status and liveness, and reads terminal outcome when a run quiesces. Observation only — no steering in this slice.

Source: Phase 4 in `v2/docs/v2-build-order.md`; `wait` contract in `v2/docs/daemon-host.md`. Done condition is merged code in `v2/src`, not this intent.

## Scope

- Run list with `runId`, project, branch, status, and liveness from daemon `list`.
- Refresh or subscribe so in-progress runs update without manual relaunch.
- Outcome panel via daemon `wait`: `runStatus`, and when present `loopOutcomeKind`, `iterationsConsumed`, `resumable`.
- Co-located tests with injectable IPC client and fixture runs.

## Out of scope

- Launching runs, log tail view, pause/resume/kill.
- Multi-run dashboard, queue view, concurrency admission (Phase 7).
- Changing `list` or `wait` RPC semantics.

## Decisions

- Outcome comes from daemon `wait`, not client-side log parsing — rules out inferring terminal state from tail events alone.
- Monitor is read-only — rules out folding pause/resume/kill into this slice.
- Deferred to first consumer: poll interval vs push refresh for live status — pin in refine.

## Documentation updates

- Operator-facing v2 doc home — document monitored fields and outcome display once UX settles.

## Prerequisites

- TUI entry command connects to the daemon at the production socket
- Daemon `list` RPC returns durable runs merged with in-memory liveness
- Daemon `wait` RPC resolves at the next invocation boundary with outcome fields when the run quiesces
