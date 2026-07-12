# Read daemon process log

Expose the detached daemon's captured stdout/stderr stream separately from
structured per-run logs.

## Decisions

- Add `jarvis daemon log`; existing `jarvis run log <id>` and `jarvis tui log <id>` read structured run records, not the process log.
- Read `~/.jarvis/daemon.log` directly; rule out attaching to the detached process or scraping its inherited stderr.
- `jarvis daemon log` prints retained content and `jarvis daemon log --follow` prints it then follows appends on stdout; rule out a TTY-only diagnostic path.
- A missing process log reports an error and exits nonzero, including while daemon status is running; rule out an empty successful diagnostic result.
- Deferred to first consumer: line-count truncation for initial replay — pin when retained-file size is insufficient for an operator.

## Tasks

- Add the daemon-log CLI parsing and file read/follow path using the production daemon log path.
- Cover replay, follow, invalid usage, and missing-log failure without coupling to a live daemon process.
- Align the operator and parity documentation.

## Acceptance criteria

- [ ] `jarvis daemon log` writes the retained daemon process stdout/stderr log to stdout and exits successfully when the file exists.
- [ ] `jarvis daemon log --follow` replays retained content, then writes appended daemon process log output until interrupted.
- [ ] `jarvis daemon log` and `jarvis daemon log --follow` reject invalid arguments with daemon-command usage and exit `1`.
- [ ] When the daemon process log is absent, `jarvis daemon log` reports the missing path on stderr and exits nonzero rather than succeeding without diagnostics.
- [ ] Focused CLI tests cover process-log replay, follow, invalid usage, and absent-file behavior.
- [ ] [`v2/docs/daemon-host.md`](../../docs/daemon-host.md) documents the process-log command, source, and its distinction from structured run logs.
- [ ] [`v2/docs/first-workflow-walkthrough.md`](../../docs/first-workflow-walkthrough.md) adds the process-log command to the "nothing is happening" recovery path.
- [ ] [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) records the v2 additive daemon process-log read behavior with source citations.

## Documentation updates

- `v2/docs/daemon-host.md` — daemon diagnostics contract.
- `v2/docs/first-workflow-walkthrough.md` — recovery workflow.
- `v2/docs/v1-behaviors.md` — v2 additive CLI behavior.
