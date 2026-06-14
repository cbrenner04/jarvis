# 02 - Detached write runs

Teach the daemon to start and list detached write-loop runs over IPC. The daemon
owns orchestration and in-memory worktree ownership for its own runs while the
existing write loop remains the core execution path.

## Decisions

- Run orchestration stays in the daemon process; agent invocation remains through
  the existing binding seam. Rules out spawning a second Jarvis worker process per
  run before isolation needs it.
- `run.start` returns after durable run creation and task scheduling, not after
  write-loop completion. Rules out a blocking start call that keeps CLI lifetime
  tied to the run.
- `run.list` reads durable state snapshots plus daemon in-memory activity, not
  log replay. Rules out deriving run status from logs.
- Keep the foreground `jarvis write` command as-is; add detached `jarvis start`.
  Rules out replacing the only foreground debug path in this phase.
- Enforce one active daemon-owned run per `(project, branch)` in memory. Rules
  out two daemon starts sharing one worktree.

Deferred to first consumer: richer run-start inputs beyond the current write
loop CLI fields - pin when project config/workflows land.

## Task checklist

- [ ] Add daemon run manager code that accepts write-loop inputs and schedules
  `executeWriteLoop` asynchronously.
- [ ] Extend daemon protocol with `run.start` and `run.list`.
- [ ] Emit structured log records for run accepted, started, iteration/result
  summary, and finished/failed.
- [ ] Ensure daemon-owned active runs reserve `(project, branch)` until terminal
  or killed.
- [ ] Add CLI commands `start`, `status`, and `log-tail` as thin IPC clients.
- [ ] Autostart the daemon for `start`, `status`, and `log-tail` if it is not
  already reachable.
- [ ] Co-located tests using injected bindings and temp state/log/socket paths.

## Acceptance criteria

- [ ] `jarvis start --project-root <path> --project <name> --branch <name>
  --base <ref> --spec <path> --artifact <path> [--agents <csv>]
  [--max-iterations <n>]` returns a run ID without waiting for completion
  (test).
- [ ] `jarvis status` lists durable run snapshots, including active daemon runs
  and completed terminal runs (test).
- [ ] `jarvis log-tail <run-id>` streams replayed and live structured records
  for that run (test).
- [ ] Starting a second active daemon run for the same `(project, branch)` is
  rejected before sharing the worktree (test).
- [ ] Detached runs use `executeWriteLoop`; the loop library does not gain
  daemon-specific process handlers or IPC knowledge.
- [ ] CLI run-control commands autostart the daemon when unreachable; lifecycle
  commands from 00 still work explicitly (test).
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v2/docs/daemon.md`: add `run.start`, `run.list`, command mapping
  (`start`, `status`, `log-tail`), autostart behavior, and active run ownership.
- [ ] `v2/docs/write-behavior.md`: document detached `jarvis start` as the
  daemon-driven path and keep `jarvis write` as foreground.
- [ ] `v2/docs/v1-behaviors.md`: no change - additive v2-only run surface.
