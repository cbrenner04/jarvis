# 03 - Iteration watchdog reliability and process-tree kill

## Problem

`iterationTimeoutMs` (default 1,800,000 ms / 30 min, per README) is
supposed to bound a single `jarvis run` iteration's wall-clock time. On
the observed live hang it did not fire:

- PID 87452 (`bun run jarvis/src/cli.ts run …`) ran for **2h 11m** before
  the diagnostic was taken, with no `[watchdog]` log line and no stop
  reason recorded in the session log.
- The stuck work was several layers below the harness's direct child:
  `jarvis run` → `opencode` agent → `bun run ready` → `bash -c "…"` →
  `bun run test` → `bun test` (PID 6951, on-CPU, the actual hang).
- The agent's direct child (opencode) was still alive and apparently
  waiting on its grandchildren's stdio; the harness's watchdog never
  intervened.

Two distinct failure modes are likely in play and both must be addressed:

1. The watchdog timer either never armed for this iteration or its
   firing path `await`s state that depends on the hung descendant
   closing its stdio.
2. Even if the watchdog fires, SIGTERMing the agent's direct child is
   insufficient when the work is being held by a grandchild that does
   not propagate the signal. The harness must kill the entire spawned
   process tree.

## Scope and decisions

- Spawn every agent (and any helper subprocess that should be subject to
  the iteration watchdog) with `detached: true` so the child becomes the
  leader of its own process group. This is the chosen process-tree-kill
  mechanism (alternatives considered: recursively walking children with
  `pgrep -P`; defense-in-depth combining both).
- On watchdog expiry the harness:
  1. Writes a single log line:
     `[watchdog] iteration timeout fired after Nms; killing agent pgid <pgid>`
     to the session log and the run terminal.
  2. Sends `process.kill(-pgid, "SIGTERM")` to the process group.
  3. Waits up to **5 s** for the group to exit.
  4. Sends `process.kill(-pgid, "SIGKILL")` to anything still alive.
  5. Resolves the iteration as a watchdog-triggered timeout (a new
     terminal stop reason, distinct from agent self-exit), recorded in
     telemetry so future hangs are visible in `~/.jarvis/runs.jsonl`.
- The watchdog timer is armed before the agent is spawned and disarmed
  when the iteration resolves through any path. It must **not** depend
  on the agent's stdio streams closing.
- The watchdog must not be reset by intermediate streaming output; it is
  a true iteration-wall-clock ceiling.
- Subspec 00 fixes the specific test that triggered this investigation;
  subspec 03 ensures that any *future* class of hang (including ones we
  cannot yet predict) is bounded in wall-clock time.

## Task checklist

- Audit the current iteration loop and agent-spawn code paths to
  identify exactly where the watchdog is (or should be) armed and
  cleared. Document the existing behavior in this file's notes during
  impl.
- Switch agent spawns to `detached: true` and capture the resulting
  PID/pgid for watchdog use.
- Implement the watchdog as a `setTimeout` (or equivalent) that does
  not depend on the agent's stdio, with the kill sequence above.
- Add a regression test (`test/iteration-watchdog.test.ts` or similar)
  with a fake agent script that:
  - Spawns a grandchild that traps SIGTERM (or busy-loops in JS) and
    refuses to exit voluntarily.
  - Runs under a very short `iterationTimeoutMs` (e.g. 2 s).
  - Asserts the iteration resolves within `iterationTimeoutMs + 7 s`,
    that no descendant pid survives, and that the session log contains
    the `[watchdog]` line.
- Add a telemetry assertion: the iteration's record in `runs.jsonl`
  carries the new stop reason.

## Acceptance criteria

- [x] Every agent spawn the harness owns runs in its own process group
  via `detached: true`.
- [x] When `iterationTimeoutMs` expires while an agent is running, the
  harness SIGTERMs the entire process group, waits up to 5 s, then
  SIGKILLs survivors, and resolves the iteration as a watchdog
  timeout.
- [x] A single `[watchdog] iteration timeout fired after Nms; killing
  agent pgid <pgid>` line appears in the session log when the watchdog
  fires.
- [x] The iteration's telemetry record in `~/.jarvis/runs.jsonl`
  reflects the new watchdog-timeout stop reason and the killed pgid.
- [x] A new regression test reproduces the SIGTERM-ignoring-grandchild
  scenario: the iteration terminates within `iterationTimeoutMs + 7 s`,
  no descendant pid survives, and the expected log line is present.
- [x] The test fails on the pre-fix code (current iteration loop) and
  passes on the fixed code.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.
- [x] `bun run check` passes.

## Documentation updates

- Update `docs/run-loop.md` (or `docs/agents.md` if more appropriate)
  to describe the watchdog behavior: armed before spawn, fires
  unconditionally on `iterationTimeoutMs`, kills the entire process
  group via SIGTERM-then-SIGKILL, records a distinct stop reason in
  telemetry.
- Note the new stop reason in any quota/error documentation that
  enumerates iteration outcomes (e.g. `docs/quota-signals.md` or
  `docs/agent-cli-failure-pipeline.md` if those enumerate stop
  reasons).
- Mention `JARVIS_READY_TIMEOUT_MS` (from subspec 02) alongside
  `iterationTimeoutMs` only if cross-referencing makes the picture
  clearer; otherwise leave them separate.
