---
name: run-log-dumps-live-runs
---

# Make `jarvis run log` usable during live runs

## Prerequisites

## Problem

`jarvis run log <id>` follows until the daemon marks the run terminal, so a live run prints nothing and blocks even while `run list` remains responsive.

## Decisions

- `jarvis run log <id>` emits every record available at request time and exits `0` for live and terminal runs; rules out follow-by-default.
- `jarvis run log <id> --follow` replays available records, tails new records, and exits when the run settles; rules out a separate tail subcommand.
- The daemon closes a snapshot stream after sending its request-time records; rules out a client timeout that can truncate output.
- Snapshot stream data precedes `stream-end`; rules out treating the defect as termination-only while live records remain hidden.

## Acceptance criteria

- [ ] `v2/src/commands/run.test.ts` regression test `run log snapshots a live non-terminal run and exits` proves a live run with existing records prints every available record and exits `0`; it fails against the current follow loop.
- [ ] Terminal-run records and exit status remain unchanged.
- [ ] `--follow` replays and tails a live run until settlement; making follow the default fails the live snapshot test.
- [ ] The client log loop has no wall-clock timeout.

## Documentation updates

- `v2/docs/operator-runbook.md` — document snapshot and `--follow` usage; replace the temporary live-run gotcha with the corrected behavior.
- `v2/docs/daemon-host.md` — document snapshot versus follow stream completion.
- `v2/docs/write-behavior.md` — document the `run log` CLI modes.
- `v2/docs/v1-behaviors.md` — record the v2 behavior change.
