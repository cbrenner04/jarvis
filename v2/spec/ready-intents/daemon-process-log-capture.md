---
name: daemon-process-log-capture
---

# Daemon process stdout/stderr are durably captured

`startDaemon` detaches with stdio discarded (`stdio: "ignore"` today). Redirect daemon stdout and stderr to a bounded rotating file under `~/.jarvis/` (e.g. `~/.jarvis/daemon.log`) so process-level exceptions, spawn failures, and harness stderr survive after detach.

## Decisions

- Capture at daemon spawn in `startDaemon`, not inside the daemon entrypoint — rules out requiring the child to reopen its own tty fds after detach.
- One rotating process log for the daemon lifetime — rules out per-run daemon log files.
- Rotation is bounded — rules out an unbounded append-only file.
- Deferred to first consumer: rotation byte cap and file count — pin when retention policy is exercised.

Update `v2/docs/daemon-host.md` with the on-disk path and rotation contract.

## Prerequisites
