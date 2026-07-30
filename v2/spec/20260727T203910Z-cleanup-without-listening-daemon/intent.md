---
name: cleanup-without-listening-daemon
---

# `jarvis cleanup` continues when no daemon is listening

## Problem

`jarvis cleanup` connects to the socket keyed to the current executable digest before any work. When nothing is listening, connect throws, stderr shows a bare `ENOENT` socket path, and dead-socket reaping plus open-home stranded-spec archival never run — though neither needs the daemon.

## Decisions

- Scope is the invoking executable's digest-keyed socket; multi-socket discovery remains out of scope.
- Daemon-independent phases (dead-socket reaping, open-home stranded scan/archival) run when that socket has no listener — rules out failing the whole command on connect `ENOENT`.
- Worktree eligibility stays fail-closed: no reachable daemon marks a worktree ineligible and skips it with a named reason — rules out aborting the command and rules out silently succeeding when merges were skipped for daemon reachability.
- Stderr names the missing-daemon condition and `jarvis daemon start` recovery — rules out surfacing the raw socket path or bare `connect ENOENT`.
- Exit 0 when no work needed a daemon; exit non-zero when one or more worktrees were skipped because the daemon was unreachable — rules out treating skipped eligibility as success.
- `listRuns()` / run-store failures still abort the command — rules out downgrading store errors to per-worktree skips (`v2/docs/operator-runbook.md` § Cleanup).

## Acceptance criteria

- [ ] With no daemon listening on the invoking executable's digest-keyed socket, `jarvis cleanup` reaps dead sockets, scans stranded open-home specs, and marks worktrees ineligible instead of aborting; a regression test in `v2/src/commands/cleanup.test.ts` or `cleanup-cli.test.ts` fails against the pre-fix abort.
- [ ] Stderr names the missing-daemon condition and `jarvis daemon start` recovery and does not print a bare keyed socket path.
- [ ] Exit status is 0 when nothing required daemon reachability and non-zero when worktrees were skipped for an unreachable daemon.
- [ ] Inverting the absent-socket continue guard turns the first regression test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — absent socket vs unreachable daemon, what still runs without a daemon, and the exit-status contract.
- `v2/docs/v1-behaviors.md` — record no-listener continue, stderr recovery hint, and exit contract for cleanup.

## Prerequisites
