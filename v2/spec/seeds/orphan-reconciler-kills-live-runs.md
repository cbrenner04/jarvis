# The orphan reconciler kills runs started on the current daemon

`daemon-reconciles-orphaned-runs-on-start` (#1430) sweeps non-terminal run rows and
marks them `killed / daemon_restart`. It also sweeps runs that the **running** daemon
started, minutes after that daemon came up — killing live work.

## Problem

Observed 2026-07-13.

```
01:56       jarvis daemon stop && jarvis daemon start     → PID 91414
01:57:36    two `implement` runs launched on that daemon  → iteration_started
02:00:07    both marked: run_reconciled  killed  daemon_restart
```

No daemon started between 01:56 and 02:00 (`~/.jarvis/daemon.log` records four starts
ever; 91414 is the last). The reconcile fired ~4 minutes into the life of the daemon
that had itself admitted both runs.

The agents did not stop. They kept working and committed their boundaries afterward,
so each run's log carries **two events with `seq: 2`** — the reconcile and the real
boundary, racing:

```json
{"seq":2,"event":{"kind":"run_reconciled","runStatus":"killed","reason":"daemon_restart"}}
{"seq":2,"event":{"kind":"boundary_committed","outcomeKind":"blocked","runStatus":"blocked"}}
```

Operator-visible result: `jarvis run list` reports `killed / resumable_kill` for a run
whose agent was still working, duplicate sequence numbers in the durable log, and a
run row whose status contradicts its own terminal event.

## Scope

- The reconciler must only ever consider rows belonging to a **prior** daemon
  incarnation. Scope it by daemon identity (pid/boot id/epoch recorded on the run row),
  not by "non-terminal at the time I looked".
- It must not run concurrently with, or after, run admission. Either complete the sweep
  before the daemon accepts its first command, or exclude anything admitted by this
  process.
- `seq` must be unique per run. Two writers producing the same sequence number is a
  durable-log integrity bug independent of the race that exposed it.

## Decisions

- Fix the scoping, not the timing. A sweep that merely runs *earlier* still races a run
  admitted a millisecond later; identity-scoping is what actually closes it.
- A run row's status must never contradict its own terminal event. If a reconcile and a
  boundary both land, the boundary is the truth — the agent's real outcome outranks the
  harness's guess about it.

## Out of scope

- Whether the runs' own outcome (`blocked`) was correct — see
  `blocked-outcome-with-no-blocker-text`.

## Documentation updates

- `v2/docs/daemon-host.md` — reconciler scope and the guarantee that it cannot touch
  runs the current process admitted.
- `v2/docs/state-store.md` — `seq` uniqueness.
