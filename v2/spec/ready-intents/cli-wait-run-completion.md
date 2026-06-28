---
name: cli-wait-run-completion
---

# CLI wait for run completion

Expose `jarvis wait <runId>` (or equivalent thin flag on an existing command) that blocks until the run is terminal and exits with a code reflecting the outcome kind so fleet shell scripts can compose without polling `list` or filtering a full log follow stream.

## Scope

- Thin CLI client over the daemon `wait` RPC — no local orchestration.
- Block until terminal; print or emit the returned terminal outcome for operator inspection.
- Exit `0` on `complete`; non-zero exit codes distinguish blocked, failed, budget-exhausted, and other terminal kinds.
- Co-located tests via injectable IPC client / test daemon fixture.

## Out of scope

- Multiplexed wait across many runs in one command.
- Notifications or external delivery.
- Changing daemon `wait` semantics.
- TUI layout.

## Decisions

- CLI is transport-only over `wait` RPC — rules out reimplementing terminal detection locally.
- Exit codes encode outcome kind for shell composition — rules out always exiting `0` on terminal regardless of outcome.
- Deferred to first consumer: command tree shape (`jarvis wait` vs `--wait` on an existing verb) — pin in refine; tests need stable invocation, not final UX.

## Documentation updates

- Operator-facing v2 CLI doc home — document `wait` usage and exit-code mapping once command names settle.
- `v2/docs/v2-architecture.md` — cross-link CLI wait to the daemon `wait` verb if not already covered by the RPC intent doc pass.

## Prerequisites

- Daemon `wait` RPC resolves on terminal boundary with outcome payload and durable `runStatus`.
