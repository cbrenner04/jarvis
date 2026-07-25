---
name: retiring-daemon-logs-what-blocks-its-exit
---

# A retiring daemon logs what blocks its exit

## Problem

At least two of the seventeen daemons started *after* both `starting-daemon-supersedes-older-daemons`
and `retire-superseded-daemon-when-idle` shipped, and still coexisted for over a day. Why they failed
to exit is not established: candidates are that supersede was never delivered (peer discovery found
no peers) and that `activeRuns` retained a stuck entry so `hasActiveRuns()` never went false.

## Decisions

- Instrument the retirement check only; do not change `shouldShutdownNow`. Four prior attempts at the
  adjacent `reapable` discriminant failed by editing the condition against a guess
  (`wedged-workflow-kill-needs-a-live-stall-signal`). Rules out a speculative condition fix.
- A daemon that is retiring but not exiting records the active-run count and the blocking run IDs in
  its process log. Run IDs, not just a count — a count cannot distinguish a real run from a wedged
  entry.
- Rate-limit or dedupe the record so a 100 ms check interval does not flood the log.
- Pin the existing contract in the same change so this work cannot regress it: a superseded daemon
  with no active runs still exits on its own without operator action.

## Acceptance criteria

- [ ] A daemon that is retiring and has not exited records, in its process log, the active-run count
      and the run IDs blocking its exit.
- [ ] The record does not repeat once per check interval.
- [ ] A superseded daemon with no active runs still exits on its own without operator action.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the retirement-blocked log record and how to read it.

## Prerequisites
