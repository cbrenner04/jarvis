---
name: daemon-child-output-test-races-process-startup
---

# `captures a real child's stdout into logPath` races real process startup

**Open, low priority.** Mitigated 2026-07-26 (#2208): 30 s bound, no busy-spin; 6/6 green. The race remains but no longer bites sessions.

## Problem

`v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` → `startDaemon` →
`captures a real child's stdout into logPath` fails intermittently under machine load, with
`Received: ""` — the log file is empty when the assertion runs.

The test spawns a **real** child process (`fake-daemon.ts`, a one-line `console.log`), lets
`startDaemon` reject at `readinessTimeoutMs: 500`, then polls `logPath` via `waitForLogMarkers`
with a fixed **3000 ms** budget. Nothing bounds the child's cold start, so the assertion is a race
between a fixed deadline and an unbounded `bun` process spawn plus stdout flush.

Two things make it worse under load:

- The poll loop spins on `setImmediate` (`daemon-lifecycle.sandbox-unrunnable.test.ts:12`) rather
  than yielding on a timer. It burns a core competing with the very process it is waiting for.
- The whole budget is 3.5 s including the readiness timeout, while the aggregate suite deliberately
  saturates the machine (`JARVIS_TEST_CONCURRENCY`, default `floor(parallelism / 2)`).

## Evidence (2026-07-26)

Reproduced in two different worktrees on the same machine, then isolated:

| Context | Result |
| --- | --- |
| `test:integration:v2`, claim-refusal worktree | fail |
| `test:integration:v2`, stale-remote worktree | fail |
| Same file, 3 consecutive isolated runs, no code change | **fail, pass, pass** |

A ~1-in-3 failure rate in isolation on an otherwise-idle-ish machine, and it reddened two
independent local gates during one session. Both times it read as a real regression before the
re-run cleared it.

## Partially mitigated 2026-07-26 — seed stays open

An operator hand-fix landed the cheap half, because this flake was actively blocking implement runs
(it stranded the `every-live-workflow-is-killable` P0 by making its agent append a `## Blocker`) and
every jarvis path to fixing it runs the same integration slice.

Done: the `setImmediate` spin is gone (25 ms sleep), a missing log file no longer throws, and the
budget is 30 s with the reasoning written down. 6/6 consecutive passes after the change; breaking
`setupLogFile`'s `openSync` still fails 4 tests, so it has not been weakened into a test that cannot
fail.

**Still open, and the reason this seed is not closed:** the assertion is still a deadline poll, not
a wait on an observable child event. A generous bound lowers the flake probability; it does not
remove the race. It also costs ~60 s to fail when capture is genuinely broken (two tests × the
budget). The event-based wait below is still the fix.

## Decisions

- The assertion waits on an observable event — child exit, or the log file becoming non-empty —
  rather than a fixed wall-clock budget racing process startup. Rules out simply raising 3000 ms,
  which moves the threshold without removing the race.
- Replace the `setImmediate` spin with a yielding wait. Rules out keeping a busy loop that steals
  CPU from the process under test. This file is `.sandbox-unrunnable`, so a real timer is permitted
  here — the determinism guard does not apply.
- Keep the test spawning a real child; it exists to prove real stdout capture. Rules out replacing
  it with a fake that would no longer cover the behavior.
- If a bound is still needed, it must be generous enough to survive a saturated machine and stated
  as such. Rules out an unexplained magic number.

## Acceptance criteria

- [ ] The test waits on child-process exit (or an equivalent observable signal) before asserting
      log content; the fixed 3000 ms race is gone.
- [ ] The poll loop no longer spins on `setImmediate`.
- [ ] The test passes 20 consecutive runs on a machine loaded to full test concurrency; record the
      command used.
- [ ] It still fails if `startDaemon` stops capturing child stdout into `logPath` — verify by
      removing the capture wiring, not by weakening the assertion.
- [ ] No other test in this file regresses.

## Documentation updates

- `v2/docs/test-writing.md` — real-child tests must wait on process events, not fixed budgets;
  note that `.sandbox-unrunnable` exemption from the determinism guard permits a timer but does not
  license a wall-clock race.
