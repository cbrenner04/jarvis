---
name: daemon-terminal-run-retention
---

# Bound terminal run history returned by the daemon

Retire older completed, failed, blocked, and killed runs from daemon `list` results after a bounded retention window. Active, queued, paused, budget-stopped, awaiting-human, and revising runs remain visible regardless of terminal-history pressure. Both `jarvis run list` and `jarvis tui` inherit the same bounded view.

## Decisions

- Apply retention in daemon `list`; rejected TUI-local hiding and a new cleanup command because other list consumers need the same bounded history.
- Retain durable run records while filtering list results; rejected destructive persistence cleanup without a storage-retention requirement.
- Deferred to first consumer: count-based versus age-based bound and its value — pin when a caller needs it.

Update `v2/docs/daemon-host.md` with retention and status exemptions.

## Prerequisites

- Daemon `list` returns durable runs merged with in-memory liveness.
