# Daemon diagnostics go to /dev/null

`startDaemon` detaches the daemon with both stdout and stderr bound to
`/dev/null` (confirmed via `lsof` on a live daemon: fds `1w` and `2w` → `/dev/null`).

## Problem

When a run misbehaves, there is nowhere to look. The structured log
(`~/.jarvis/state/logs.jsonl`) only carries modelled events — `iteration_started`,
`loop_finished`. Anything the daemon *says* — an exception, a spawn failure, an
agent's stderr, a stack trace — is discarded at the file-descriptor level.

Observed 2026-07-12: four plan runs logged `iteration_started` and then nothing,
forever. No agent process was ever spawned, no timeout fired, no error surfaced.
`run list` reported them `in-progress` / `live` indefinitely; `run kill` returned
`run_not_active`. Diagnosing it required `lsof` and `ps` against the daemon PID,
and even then the cause was unrecoverable because the daemon had thrown its own
output away.

## Scope

- Redirect daemon stdout/stderr to a rotating file under `~/.jarvis/` (e.g.
  `~/.jarvis/daemon.log`) instead of `/dev/null`.
- Surface a way to read it: `jarvis daemon log` (or fold into an existing surface
  — see Decisions).
- Capture per-invocation agent stdout/stderr durably, the way v1 writes
  `~/.jarvis/sessions/<name>.log`. v2 currently writes no session log at all for
  a stalled invocation, so there is no evidence the agent was even spawned.
- An unhandled rejection or thrown error inside a run's async path must land in
  the run's structured log as a terminal event, not vanish.

## Decisions

- Prefer folding the read path into an existing surface over adding a command.
  `jarvis run log <id>` already exists for structured records — the daemon's own
  process log is a different stream and probably does warrant `daemon log`, but
  the implementer should confirm before adding a subcommand.
- Rotation must be bounded; v1 session logs already reach ~1 MB per run.

## Out of scope

- Fixing the stall itself — see `plan-workflow-stalls-with-no-agent`.
- Restructuring the structured-log event schema.

## Documentation updates

- `v2/docs/daemon-host.md` — where daemon diagnostics live and how to read them.
- `v2/docs/first-workflow-walkthrough.md` — the "nothing is happening" recovery path.
