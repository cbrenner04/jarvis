---
name: daemon-socket-keyed-by-executable-digest
---

# Key the daemon socket by executable digest

## Problem

- One fixed `daemon.sock` lets a CLI reach daemon code built from different sources, so compatibility must be negotiated after connecting instead of decided before.

## Outcome

- Every CLI IPC connection and daemon lifecycle operation resolves `daemon-<executable-tree-digest>.sock` before connecting.
- Daemons with different digests coexist, each with its own socket, PID file, and process log.
- `run list` and `run wait` return only rows from the daemon the invoking executable selected.

## Decisions

- Use `shared/executable-tree.ts`'s full digest as the socket key; rules out Git revision or a second compatibility identity.
- Resolve the keyed identity before any IPC connection; rules out probing a fixed socket and negotiating through `status`.
- Key the PID and process-log paths alongside the socket; rules out shared lifecycle metadata across concurrently running daemons.
- Leave the legacy `daemon.sock` and any daemon serving it untouched; rules out migration probes, stops, replacement, or cleanup.
- Scope observation and steering to the selected daemon; rules out accidental cross-daemon requests.
- Deferred to first consumer: cross-daemon TUI aggregation.

## Acceptance criteria

- [ ] Health, status, list, wait, stop, and dispatch all connect to the digest-keyed socket, and a differently keyed or legacy socket receives no request.
- [ ] Two daemons keyed by different digests run concurrently without sharing socket, PID, or log paths.
- [ ] `run list` and `run wait` report only the selected daemon's rows.
- [ ] A regression test proves a differently keyed live daemon is not contacted, and fails against the pre-change fixed-socket code.

## Documentation updates

- `v2/docs/daemon-host.md` — digest-keyed socket, PID, and log paths.

## Prerequisites

- The executable-tree digest is already computed for dispatch guarding.
