---
name: run-log-blocks-on-live-runs
---

# `jarvis run log` blocks forever on a live run

## Problem

`jarvis run log <id>` is unusable on a run that is currently running — the exact moment an operator
needs it. It hangs indefinitely and prints nothing.

`runLogSubcommand` (`v2/src/commands/run.ts:326-356`) opens a stream and loops until it receives
`stream-end`. The daemon sends `stream-end` only when the run is terminal, so a live run's stream
never ends and the command never returns.

## Evidence (2026-07-26, one live implement run)

| Command | Result |
| --- | --- |
| `jarvis run log <live-run>` | hung past 120s, **zero** records printed |
| `jarvis run log <terminal-run>` | returned in 0.295s, 5 records |
| `jarvis run list --limit 3` | returned in 0.246s, during the same live run |

**This is not the documented "daemon goes deaf" gotcha** (operator-runbook.md, 2026-07-12), which
attributes the hang to the daemon blocking on sync git in the publication path and reports
`run list` hanging too. The daemon was fully responsive throughout: `list` answered in 246ms while
`log` was blocked. The remaining defect is `run log`'s own termination condition, and the runbook
entry should stop implying otherwise.

## Decisions

- `jarvis run log <id>` dumps the records that exist and exits, for live and terminal runs alike.
  Rules out leaving a follow as the default — it makes the command useless on live runs, and a
  one-shot dump is what every diagnostic use in the runbook actually wants.
- Follow/tail stays available behind an explicit opt-in flag on the same command. Rules out a new
  subcommand: `jarvis tui log <id>` already owns interactive tailing across keyed daemons.
- The daemon terminates the stream for a live run once it has sent the records available at request
  time. Rules out fixing this client-side with a timeout, which would truncate arbitrarily and still
  report success.
- Zero records printed before the block is its own bug — a live run with existing records must emit
  them. Rules out treating this as purely a termination-condition fix.

## Acceptance criteria

- [ ] `jarvis run log <id>` against a **live** run prints the records that exist and exits `0`; a
      test drives a live (non-terminal) run and fails against the pre-fix loop.
- [ ] `jarvis run log <id>` against a terminal run is unchanged — same records, same exit code;
      existing coverage stays green.
- [ ] A live run that has already appended records emits all of them; a test asserts a non-empty
      dump and fails if the daemon sends `stream-end` before the records.
- [ ] The follow flag tails a live run and terminates when the run settles; inverting the flag's
      default (follow-by-default) turns the live-run test RED.
- [ ] No wall-clock timeout appears in the client loop.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Observe: `run log` is a one-shot dump; name the follow flag.
  Correct the 2026-07-12 "daemon goes deaf" gotcha: `run list` is responsive during live runs, and
  the `run log` hang was this termination condition, not daemon blocking.
- `v2/docs/daemon-host.md` — the log stream's end condition for live runs.
- `v2/docs/write-behavior.md` — `run log` CLI surface and the follow flag.
