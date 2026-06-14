# 03 - Steering and cancellation

Add pause, resume, and kill to daemon-owned runs. Pause is graceful at the next
loop boundary; kill is immediate; resume branches on whether the prior stop was
boundary-clean or interrupted.

## Decisions

- Add run statuses/stop cause needed by steering to durable state only when this
  steering caller lands. Rules out overloading `budget-soft-stopped` to mean
  paused or killed.
- Pause uses a daemon pause request checked between write-loop iterations, not
  forced `AbortSignal` abort mid-iteration. Rules out losing work for a graceful
  pause or reusing abort behavior that already means interrupted recovery.
- Kill aborts the active invocation immediately through `AbortController` and
  process-group termination when the binding owns a child process. Rules out
  waiting for the next loop boundary on kill.
- Resume after paused-at-boundary continues with the next iteration; resume after
  killed/crashed mid-step reuses the existing interrupted-attempt recovery path.
  Rules out a separate killed-run replay algorithm.
- Pause records a boundary-clean disposition distinct from killed/crashed
  interruption. Rules out re-running completed work after a graceful pause.
- Process-group kill scope is limited to real child-process invocation bindings;
  tests keep injectable abort behavior. Rules out redesigning run orchestration
  into worker processes solely for kill.
- CLI steering verbs are exactly `pause`, `resume`, and `kill`. Rules out adding
  edit/message/reorder controls in Phase 3.

Deferred to first consumer: pause reasons and human-loop decisions - pin when
Phase 6 adds planned human pauses.

## Task checklist

- [x] Extend state/store types and migrations for paused/killed status and a
  stop-cause/disposition field sufficient to distinguish boundary-clean pause
  from interrupted kill/crash.
- [x] Add a pause boundary hook or minimal loop option so `executeWriteLoop`
  can stop cleanly between iterations without daemon-specific IPC knowledge.
- [x] Add abortable process-group support at the invocation binding seam needed
  for real child-process kill; keep tests injectable.
- [ ] Extend daemon protocol with `run.pause`, `run.resume`, and `run.kill`.
- [ ] Add CLI commands `pause <run-id>`, `resume <run-id>`, and `kill <run-id>`.
- [ ] Emit structured log records for pause requested, paused, resumed, kill
  requested, killed, and resume branch.
- [ ] Co-located tests for graceful pause, resume, immediate kill, and crash-like
  interrupted resume.
- [x] Update invocation kill/abort contract docs if the binding seam changes.
- [ ] Run `bun run ready` for this materially invasive steering slice.

## Acceptance criteria

- [ ] `jarvis pause <run-id>` on an active run records a pause request and the
  run stops at the next loop/iteration boundary with no in-progress attempt left
  uncommitted (test).
- [ ] Pause completion records a boundary-clean disposition distinct from
  killed/crashed interruption (test).
- [ ] `jarvis resume <run-id>` after a boundary-clean pause continues with the
  next write-loop iteration rather than re-running the completed one (test).
- [ ] `jarvis kill <run-id>` aborts an active invocation immediately, marks the
  run killed, and leaves any dirty worktree recoverable (test with injected
  binding; process-group behavior covered where child bindings exist).
- [ ] `jarvis resume <run-id>` after killed/crashed mid-step re-runs the
  interrupted attempt over the dirty worktree via the existing recovery path
  (test).
- [ ] Steering API rejects verbs other than pause/resume/kill.
- [ ] Structured logs expose requested and resulting steering states for tail
  consumers.
- [ ] No `v2 -> v1` imports; `bun run typecheck`, `bun test`, and
  `bun run ready` pass.

## Documentation updates

- [ ] `v2/docs/daemon.md`: add steering methods, CLI commands, status/stop-cause
  meanings, and error cases.
- [ ] `v2/docs/write-behavior.md`: document graceful pause, kill/crash recovery,
  and resume branch behavior for daemon-driven runs.
- [x] `v2/docs/state-store.md`: document any new statuses/stop-cause fields and
  their resume reads.
- [x] `v2/docs/shared-invocation.md` or the actual durable invocation-binding
  home: document child-process kill/abort contracts if the seam changes.
- [ ] `v2/docs/v2-architecture.md`: align with the as-built second-host model.
- [ ] `v2/docs/v2-build-order.md` and `v2/spec/v2-meta-index.md`: check off
  Phase 3 after implementation passes.
- [ ] `v2/docs/v1-behaviors.md`: no change - additive v2-only steering surface.
