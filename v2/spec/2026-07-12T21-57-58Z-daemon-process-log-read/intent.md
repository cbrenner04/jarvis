---
name: daemon-process-log-read
---

# Operator can read the daemon process log

Surface a CLI path to tail or print the daemon's own process log. This is not `jarvis run log <id>` (structured run records); it is the detached daemon's stdout/stderr stream.

## Decisions

- Confirm whether an existing CLI surface can expose the process log before adding `jarvis daemon log` — rules out a new subcommand when an existing read path already fits.
- Read from the captured on-disk file — rules out attaching a live tty or scraping daemon stderr after detach.
- Follow or print recent lines to stdout; exit nonzero on missing file when the daemon is expected to be running — rules out silent empty success when diagnostics were discarded.

Update `v2/docs/daemon-host.md` with how to read daemon diagnostics and `v2/docs/first-workflow-walkthrough.md` with a daemon-log step in the "nothing is happening" recovery path.

## Prerequisites

- Daemon process stdout/stderr are durably captured under `~/.jarvis/` with bounded rotation.
