# Read daemon process log

Expose the detached daemon's captured stdout/stderr stream separately from
structured per-run logs.

## Decisions

- Add `jarvis daemon log`; `jarvis run log <id>` and `jarvis tui log <id>` read structured run records, not the process log.
- Accept only `jarvis daemon log [--follow]`; rule out flags, alternate orders, and other daemon-log forms.
- Default the injectable daemon-log path to `~/.jarvis/daemon.log`; rule out a hard-coded-only production path.
- Read the log path without PID, socket, or IPC-status checks; rule out daemon liveness as a prerequisite for on-disk diagnostics.
- `jarvis daemon log` writes retained bytes to stdout, while `--follow` replays then follows on stdout; rule out a TTY-only diagnostic path.
- Make replay-to-follow lossless: bytes appended during handoff are emitted once; rule out a replay/follow gap or overlap.
- On truncate or replacement, `--follow` resumes from the configured path's current file; rule out tailing a stale inode.
- On removal, `--follow` reports the missing configured path on stderr and exits nonzero; rule out silently tailing the removed file or waiting indefinitely.
- Read, watch, and reopen failures report stderr errors and exit nonzero; rule out partial successful or silently hanging diagnostics.
- SIGINT stops `--follow` and exits `130`; rule out treating operator interruption as diagnostic failure.
- Deferred to first consumer: line-count truncation for initial replay — pin when retained-file size is insufficient for an operator.

## Tasks

- Add the daemon-log CLI parser and injectable file read/follow path.
- Cover replay, handoff, path changes, failures, SIGINT, and invalid usage without a live daemon.
- Align the operator and parity documentation.

## Acceptance criteria

- [ ] `jarvis daemon log` writes the retained daemon process stdout/stderr log to stdout and exits successfully when the configured file exists, regardless of daemon PID, socket, or IPC status.
- [ ] `jarvis daemon log --follow` replays retained content and emits each byte appended during the replay-to-follow handoff exactly once.
- [ ] `jarvis daemon log --follow` follows appends from the configured path after truncation or replacement, and reports a removed path on stderr with a nonzero exit instead of tailing its stale file.
- [ ] `jarvis daemon log --follow` reports read, watch, or reopen failures on stderr and exits nonzero; SIGINT exits `130`.
- [ ] Only `jarvis daemon log` and `jarvis daemon log --follow` are accepted; flags, alternate orders, and other forms print daemon usage and exit `1`.
- [ ] When the daemon process log is absent, `jarvis daemon log` reports the configured missing path on stderr and exits nonzero rather than succeeding without diagnostics.
- [ ] Focused CLI tests use an injected log path and cover replay, lossless follow handoff, path changes, failures, SIGINT, invalid usage, and absent-file behavior.
- [ ] [`v2/docs/daemon-host.md`](../../docs/daemon-host.md) documents the process-log command, source, and its distinction from structured run logs.
- [ ] [`v2/docs/first-workflow-walkthrough.md`](../../docs/first-workflow-walkthrough.md) adds the process-log command to the "nothing is happening" recovery path.
- [ ] [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) documents the daemon-log CLI contract.
- [ ] [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) records the v2 additive daemon process-log read behavior with source citations.

## Documentation updates

- `v2/docs/daemon-host.md` — daemon diagnostics contract.
- `v2/docs/first-workflow-walkthrough.md` — recovery workflow.
- `v2/docs/write-behavior.md` — daemon-log CLI contract.
- `v2/docs/v1-behaviors.md` — v2 additive CLI behavior.
