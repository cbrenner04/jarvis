# 03 - Operator runbook and v1 parity docs

## Problem

`v2/docs/operator-runbook.md` § Daemon lifecycle still documents stale-only socket removal (`ECONNREFUSED` unlinks; `ENOENT` removes nothing; 250ms timeout ⇒ live) without the occupancy-aware reclaim contract from subspec 00, and has no recovery path for a wedged `daemon start` that subspec 02's error names. `v2/docs/v1-behaviors.md` does not record startup reclaim of an unbindable leftover socket.

## Decisions

- Reconcile operator-runbook socket-probe prose with `daemon-host.md` rather than duplicating the full reclaim algorithm; rules out a second authoritative contract home.
- Note that bind-failure diagnosis still lives in `~/.jarvis/daemon-<digest>.log` for startup deaths subspec 02 does not yet type; rules out implying the CLI always replaces the log for every startup failure.

## Prerequisites

- Subspec 00 occupancy-aware reclaim and `daemon-host.md` contract.
- Subspec 02 operator-facing bind-failure error.

## Task checklist

- [ ] Reconcile `v2/docs/operator-runbook.md` § Daemon lifecycle socket-probe/reclaim prose with `daemon-host.md`.
- [ ] Add wedged `daemon start` recovery guidance (including `jarvis cleanup` and log location).
- [ ] Record startup reclaim of an unbindable leftover socket in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` reconciles § Daemon lifecycle socket-probe/reclaim prose (stale-only removal, `ENOENT` skips removal, 250ms timeout ⇒ live) with the occupancy-aware reclaim contract in `daemon-host.md`, and documents recovery for a wedged `daemon start` including that diagnosis lives in `~/.jarvis/daemon-<digest>.log` until `daemon-process-log-read` ships.
- [ ] `v2/docs/v1-behaviors.md` records reclaim of an unbindable leftover socket on daemon start with sources pointing at `v2/src/ipc/server.ts` and `v2/docs/daemon-host.md`.

## Documentation updates

- `v2/docs/operator-runbook.md` — reconcile socket-probe/reclaim prose; wedged `daemon start` recovery.
- `v2/docs/v1-behaviors.md` — startup reclaim of an unbindable leftover socket.
