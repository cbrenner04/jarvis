---
name: tui-run-log-follow
---

# TUI structured log follow view

Separate terminal view that replays and streams a run's structured log events over the daemon IPC tail channel. Architecture's log window alongside the dashboard — not free-text stderr.

Source: Phase 4 in `v2/docs/v2-build-order.md`; log follow contract in `v2/docs/v2-architecture.md` and `v2/docs/daemon-host.md`. Done condition is merged code in `v2/src`, not this intent.

## Scope

- Operator opens a log view for a run ID; events render as they arrive.
- IPC tail stream: replay persisted records in `seq` order, then follow live appends.
- Minimal event rendering (kind + key fields); polish deferred.
- Co-located tests with injectable IPC client and fixture log records.

## Out of scope

- Dashboard layout, run launch, status list, outcome summary, steering.
- Log retention, rotation, compaction, search/filter UX.
- Changing tail-stream server semantics.

## Decisions

- Log view is a separate surface from the run dashboard — rules out folding tail into one full-screen dashboard in this slice.
- Renders structured `PersistedRecord` events, not CLI stderr — rules out shelling out to `jarvis run log`.
- Deferred to first consumer: multi-window vs split-pane mechanics — pin in refine; tests use injectable view host.
- Deferred to first consumer: event formatting, colors, and scroll UX — pin as dogfooding learns.

## Documentation updates

- Operator-facing v2 doc home — document how to open the log follow view for a run once command UX settles.

## Prerequisites

- TUI entry command connects to the daemon at the production socket
- Daemon IPC tail stream replays persisted log records then streams new appends for a run
