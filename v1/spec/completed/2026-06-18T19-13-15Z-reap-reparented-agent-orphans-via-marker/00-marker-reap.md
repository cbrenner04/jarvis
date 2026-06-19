# Reap re-parented agent orphans by tracking descendant PIDs

## Problem

Agent tools can place a descendant in a new session/process group (e.g. a
`bun run test` → `bun test` subtree that calls `POSIX::setsid()`). When the
watchdog kills `-pgid`, that descendant escapes the group kill and, once its
agent exits, re-parents to init (PPID=1) and pegs CPU for minutes after its
agent is gone. These orphans accumulate across iterations. `-pgid` alone cannot
reach them because they are no longer in the group, and once they re-parent
there is no live lineage back to the harness. On the target OS (darwin / macOS
26) `ps` does not expose process environments to an unprivileged caller, so an
inherited env marker cannot be discovered after the fact; only the
`pid`/`ppid`/`pgid`/start-time columns are reliably visible.

## Decisions

Decision: track orphans by PID rather than an inherited env marker. — rules out the env-marker approach: macOS 26 strips environments from `ps` output for unprivileged callers, so a marker is undiscoverable at reap time (verified: no `ps` form surfaces a child's env).
Decision: while an agent runs, sample the process table on a fixed interval and accumulate every PID descended from the agent — transitive `ppid` links plus any process still sharing the agent's `pgid`. — rules out a single end-of-iteration snapshot: after the agent exits, escapees have re-parented to init and their lineage is gone, so they must be captured while still attached.
Decision: start sampling from the spawned agent pid in `onSpawned` (immediate sample + interval) and stop in the per-iteration `finally`, with one final sample before reaping. — rules out tying capture to the watchdog pgid only, which a setsid escapee leaves.
Decision: record each PID with its start time (`lstart`) as identity; at reap, SIGKILL a recorded PID only if it is still present with an unchanged start time. — rules out a bare PID kill that could hit an unrelated process which recycled the PID.
Decision: never target the harness's own process. — rules out a self-kill if the harness pid ever appears in a subtree walk.
Decision: reaping reads only `pid`/`ppid`/`pgid`/start time; it never reads, logs, or stores process environments or command arguments. — rules out leaking other processes' state.
Decision: reaping is best-effort and never alters run exit codes or stop reasons; listing and kill errors are swallowed. — rules out treating a reap failure as a run error.
Decision: reap in `runIteration`'s single per-iteration `finally` (covering all return/exit sites, settle and abort/timeout alike) and in `runCommand`'s finalize `finally` (covering the SIGINT and `{ kind: "exit" }` `process.exit` paths), reaping the run-level accumulator both times. — rules out bolting reaping onto only the timeout branch, which leaks orphans from quota/no-progress/blocker/exit/normal-settle exits.
Decision: the reap entry point is overridable for tests (paralleling `__testKillGraceMs`) so an induced failure is injectable deterministically at run level. — rules out a unit-only try/catch that never proves the run exit code is unaffected.

Deferred to first consumer: whether plan/review/prompt/shrink spawns also reap — pin when a caller needs it. This subspec scopes reaping to the patch iteration loop and finalize.

## Tasks

- Add a `DescendantTracker` reap helper: `listProcesses()` (pid/ppid/pgid/start-time, never env), `collectSubtree(rootPid, procs)` (transitive `ppid` descendants + shared-`pgid` members, excluding the root), `poll(rootPid)` to accumulate descendants with their start-time identity, and `reap()` to SIGKILL surviving recorded PIDs whose start time is unchanged (skipping the harness pid). Never throw; return the killed count.
- Create one run-scoped tracker in `runCommand`; sample the agent subtree on an interval started in `onSpawned` and cleared in the per-iteration `finally`.
- Reap from `runIteration`'s per-iteration `finally` and from `runCommand`'s finalize `finally`; make the reap entry point test-overridable (parallel to `__testKillGraceMs`).
- Net-new fixture (non-trivial): an "agent" that forks a grandchild which escapes via `POSIX::setsid()` and survives `-pgid`; prove the tracker captures it while attached and SIGKILLs it after it re-parents to init.
- Net-new test (non-trivial): force the overridable reap entry point to throw and assert the run's exit code is unchanged.
- Update docs listed below.

## Acceptance criteria

- [x] While an agent runs, the harness samples its process subtree and records every descendant PID (transitive `ppid` plus shared-`pgid` members), capturing escapees while their lineage is still intact.
- [x] A descendant that re-parents to init (PPID=1, own session via `POSIX::setsid()`) and survives the `-pgid` group kill is SIGKILLed by the harness at iteration end and/or finalize rather than left running.
- [x] Reaping runs in the per-iteration `finally` (covering settle, abort/timeout, and every other iteration exit) and in run finalize (covering the SIGINT and direct-`process.exit` paths).
- [x] A reaping failure (process listing or kill error) does not change the run's exit code or stop reason.
- [x] Reaping targets only recorded descendants of this run's agents; the harness's own process is never targeted, and a recycled PID whose start time changed is skipped.
- [x] Reaping reads only `pid`/`ppid`/`pgid`/start time; process environments and command arguments are never logged or stored.
- [x] Existing watchdog, iteration-timeout, run-timeout, and finalize behavior is unchanged: the watchdog still logs `[watchdog] iteration timeout fired after Nms; killing agent pgid <pgid>`, group SIGTERM→SIGKILL escalation still occurs, and timeout/finalize exit codes are unchanged.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: describe PID-tracking orphan reaping — proactive subtree sampling during the iteration, reap of survivors in the per-iteration `finally` (all exit paths) and at finalize, start-time identity to avoid recycled-PID kills, best-effort and non-fatal, reads only pid/ppid/pgid/start time and never process environments. Note that macOS hides environments from `ps`, which is why an env marker is not used.
- `v1/docs/agents.md`: note that Jarvis adds no env marker to agent spawns; orphan cleanup is by descendant-PID tracking. Keep it distinct from the prompt-appended HTML-comment usage-correlation marker.
- `v2/docs/v1-behaviors.md`: under "Abort and process lifecycle", record PID-tracking orphan reaping as current v1 behavior (interval subtree sampling, reap in per-iteration `finally` and finalize, start-time reuse guard, no environment logging, best-effort, exit codes unchanged).
