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
- Daemon-owned `(project, branch)` ownership is held for active, paused, blocked,
  budget-soft-stopped, and killed runs, then released on done, failed, or
  explicit cleanup. Rules out starting another daemon run over resumable or dirty
  work.
- Daemon startup rebuilds ownership guards from durable nonterminal run state.
  Rules out losing paused/killed exclusivity across daemon restart.

Deferred to first consumer: richer run-start inputs beyond the current write
loop CLI fields - pin when project config/workflows land.

## Task checklist

- [x] Add daemon run manager code that accepts write-loop inputs and schedules
  `executeWriteLoop` asynchronously.
- [x] Extend daemon protocol with `run.start` and `run.list`.
- [x] Emit structured log records for run accepted, started, iteration/result
  summary, and finished/failed.
- [x] Ensure daemon-owned active runs reserve `(project, branch)` until terminal
  or explicit cleanup according to the ownership lifetime decision.
- [x] Add CLI commands `start`, `status`, and `log-tail` as thin IPC clients.
- [x] Autostart the daemon for `start`, `status`, and `log-tail` if it is not
  already reachable.
- [x] Rebuild in-memory ownership from durable nonterminal run state on daemon
  startup.
- [x] Co-located tests using injected bindings and temp state/log/socket paths.

## Acceptance criteria

- [x] `jarvis start --project-root <path> --project <name> --branch <name>
  --base <ref> --spec <path> --artifact <path> [--agents <csv>]
  [--max-iterations <n>]` returns a run ID without waiting for completion
  (test).
- [x] `jarvis status` lists durable run snapshots, including active daemon runs
  and completed terminal runs (test).
- [x] `jarvis log-tail <run-id>` streams replayed and live structured records
  for that run (test).
- [x] Starting a second active daemon run for the same `(project, branch)` is
  rejected before sharing the worktree (test).
- [x] Starting a daemon with paused, blocked, budget-soft-stopped, or killed
  durable runs rebuilds ownership and rejects conflicting starts until cleanup or
  terminal release (test).
- [x] Detached runs use `executeWriteLoop`; the loop library does not gain
  daemon-specific process handlers or IPC knowledge.
- [x] CLI run-control commands autostart the daemon when unreachable; lifecycle
  commands from 00 still work explicitly (test).
- [x] No `v2 -> v1` imports; `bun run typecheck`, `bun test`, and
  `bun run ready` pass.

## Documentation updates

- [x] `v2/docs/daemon.md`: add `run.start`, `run.list`, command mapping
  (`start`, `status`, `log-tail`), autostart behavior, run-status output, and
  daemon-owned `(project, branch)` ownership lifetime.
- [x] `v2/docs/write-behavior.md`: document detached `jarvis start` as the
  daemon-driven path and keep `jarvis write` as foreground.
- [x] `v2/docs/v1-behaviors.md`: explicitly state this is an additive v2-only
  run surface and does not alter v1 resume/lock behavior.
