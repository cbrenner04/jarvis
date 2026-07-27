---
name: cleanup-aborts-on-a-missing-keyed-socket
---

# `jarvis cleanup` aborts on a missing keyed socket, with a message that names no action

## Problem

`jarvis cleanup` opens one connection to the socket keyed to the **current executable digest**. When
no daemon is listening on that key, the connect throws and the command stops:

```text
$ jarvis cleanup -y
connect ENOENT /Users/…/.jarvis/daemon-04db5583cf08bb75.sock
```

Exit status is 1, so scripts and `&&` chains do stop — that part is correct. Two things are not:

**The message names a socket path and no action.** Nothing in it says a daemon is not running, or
that `jarvis daemon start` fixes it. The operator sees a raw `ENOENT` against a hex-keyed path they
have no reason to recognize.

**It aborts work that needs no daemon.** Dead-socket reaping and open-home stranded-spec archival
never run, though neither consults the daemon. The documented contract is to fail *closed* — "if `gh`
fails or the daemon is unreachable, the worktree is marked ineligible and skipped"
(`v2/docs/operator-runbook.md` § Cleanup: eligibility gate). Skipping worktrees is not aborting the
command, so either the behavior or that paragraph is wrong.

No other command behaves this way: `jarvis run list` discovers every live keyed socket and merges
across them; `jarvis run workflow` auto-starts a daemon when none is listening; `jarvis daemon
status` reports `stopped` and exits 0.

## Evidence (2026-07-27)

Merges rebuilt the executable, changing the digest key. One daemon was alive on
`daemon-703897140144f101.sock` (older digest) while the CLI wanted
`daemon-04db5583cf08bb75.sock`, and nothing had dispatched since the last merge to auto-start one.

| Command, same window | Result |
| --- | --- |
| `jarvis cleanup -y` | `connect ENOENT …`, nothing done, exit 1 |
| `jarvis run list` | full run table, exit 0 |
| `jarvis daemon status` | `stopped`, exit 0 |

Reproduced deterministically with an isolated `JARVIS_HOME` containing no socket: exit 1, same
message. Recovery was `jarvis daemon start`, then cleanup ran normally.

## Decisions

- The failure names the condition and the fix ("no daemon is listening for this build; run `jarvis
  daemon start`"), not a raw socket path. Rules out surfacing the `ENOENT` verbatim.
- Daemon-independent work — dead-socket reaping, stranded-spec archival — runs before or despite the
  daemon probe. Rules out one probe failure disabling the whole command.
- Worktree eligibility keeps its documented fail-closed behavior: unreachable daemon means ineligible
  and skipped, named per worktree. The command still exits non-zero when it skipped work for that
  reason. Rules out both aborting and silently succeeding.
- Cleanup reuses the live-socket discovery `jarvis run list` uses instead of a single
  current-digest connection, so a live daemon on an older digest is still consulted. Rules out
  merely tolerating an absent key — an older-digest daemon may genuinely own a live run.

## Acceptance criteria

- [ ] With no daemon listening on any key, `jarvis cleanup` reaps dead sockets, scans stranded
      artifacts, and marks worktrees ineligible rather than aborting; a test drives the absent-socket
      case and fails against the current abort.
- [ ] Its stderr names the missing-daemon condition and the `jarvis daemon start` recovery, and does
      not print a bare socket path.
- [ ] It exits non-zero when worktrees were skipped for an unreachable daemon, and exits 0 when
      nothing needed the daemon.
- [ ] With a live daemon on an older digest key only, cleanup consults it via socket discovery and
      honors a live run it reports; a test fails if the older-digest daemon is ignored.
- [ ] Normal cleanup with a matching-key daemon is unchanged; existing coverage stays green.
- [ ] Inverting the missing-socket branch turns the first test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — absent socket vs. unreachable daemon,
  what still runs, and the exit-status contract.
- `v2/docs/daemon-host.md` — cleanup uses live-socket discovery, not a single keyed connection.
