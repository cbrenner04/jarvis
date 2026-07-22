# `run list` goes blind to in-flight runs after a merge rotates the digest

## Problem

`jarvis run list` connects to the socket for the *invoking* executable's digest. Merging any
`v2/src/**` change to `main` rotates that digest, so the very next `run list` targets a socket no
daemon has created yet and exits:

```text
connect ENOENT /Users/christopherbrenner/.jarvis/daemon-fd841dda1856594b.sock
```

The runs the operator was watching are still executing, under the *previous* daemon on the previous
socket. They are simply unreachable: `run list`, `run log`, and `run wait` all resolve the same way,
so the operator loses every observation surface for in-flight work at the exact moment they merged.

Observed 2026-07-22, twice in one session, both times with three implement runs live. Recovery was
to stop using jarvis for observation and poll `gh pr list` instead until a later dispatch started a
daemon on the new digest.

This is a direct cost of digest-keyed daemons (#1958) and is not addressed by the work already
queued around them: `tui-aggregates-live-daemons` explicitly decides that "`run list` and `run wait`
keep using the single-socket dispatch path", and `retire-superseded-daemon-when-idle` retires the
old daemon *sooner*, which removes the runs from view faster rather than making them visible.

The merge-then-observe sequence is the normal operator loop, not an edge case: every landed PR in a
session rotates the digest while the rest of the fleet is still running.

## Decisions

- Observation commands (`run list`, `run log`, `run wait`) read across live keyed daemons, not only
  the invoking digest's socket. Rules out requiring the operator to know which digest owns a run.
- Reuse the live-socket discovery built for `tui-aggregates-live-daemons` rather than adding a
  second enumeration; rules out two discovery implementations drifting apart.
- Dedupe merged rows by run ID, preferring the daemon that reports the row `isLive`, matching the
  TUI's ownership rule. Rules out double-listing rows that every daemon returns from the shared
  store.
- A socket that fails to answer is skipped, leaving the other daemons' rows listed. Rules out one
  dead socket blanking the whole listing.
- No new subcommand or flag; this is the behavior of the existing commands. Rules out
  `run list --all-daemons`.

## Acceptance criteria

- [ ] With two live keyed daemons under one home and a run live on the non-invoking one,
      `run list` includes that run; a test fails against the current single-socket path.
- [ ] `run list` reports no duplicate run IDs when several daemons return the same durable row, and
      the row rendered is the one whose daemon reports it `isLive`.
- [ ] A socket present but unreachable is skipped and the remaining daemons' rows are still listed.
- [ ] `run log` and `run wait` resolve a run owned by a non-invoking live daemon.
- [ ] When only the invoking digest's daemon is live, output is byte-identical to today — the
      negative case proves aggregation did not change the solo-daemon rendering.
- [ ] When no daemon is live at all, the existing error is unchanged.
- [ ] Inverting each added guard (the liveness skip, the dedupe ownership rule) fails a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — observation commands aggregate across live keyed daemons; correct any
  claim that they are scoped to the invoking digest.
- `v2/docs/operator-runbook.md` § Observe — a merge no longer blinds `run list`.

## Prerequisites

- Live digest-keyed socket discovery exists (`tui-aggregates-live-daemons`, subspec `00`).
