# 01 - Write loop opens a session log per iteration

Wire the writer from [00](./00-invocation-session-log-writer.md) into v2's write path: each
write-loop iteration opens its own session log before the agent subprocess spawns and
closes it when the iteration settles — including timeout, abort, and thrown-error paths.
After this, an operator whose run stalls has a file on disk naming the run, spec, and
iteration, the agent/model invoked, the prompt sent, and how the iteration ended. A stalled
iteration's log carries no agent output: bindings return stdout/stderr only on the settled
result.

## Decisions

- One log file per write-loop iteration, named
  `~/.jarvis/sessions/<namespace>-<timestamp>.log`, where `<namespace>` is the run id —
  rules out one shared file per run and one file per binding attempt in the fallback chain.
- `<timestamp>` is millisecond-granularity ISO (filesystem-safe) — rules out v1's
  second-granularity stamp, under which two iterations of the same run collide into one
  append-mode file and no distinct second file exists.
- Sessions dir and clock are write-loop inputs, defaulting to `~/.jarvis/sessions/` and
  the system clock — rules out deriving the path from `$HOME` inside the loop, which
  forces tests to write into the operator's real sessions dir.
- The write loop stamps a `harness` line naming the run, spec, and iteration before the
  step runs — rules out a file whose only pre-spawn content is the prompt.
- The iteration-settle path writes a final `harness` line naming the outcome kind
  (completed / timeout / abort / error) and then closes the log — rules out a file where
  a timed-out, aborted, and errored iteration are indistinguishable on disk, and rules out
  closing only on the happy path.
- Deferred to first consumer: incremental `inbound_*` streaming from the binding — pin
  when an operator needs partial agent output from a stalled invocation.
- Deferred to first consumer: filename slug beyond `<namespace>-<timestamp>` — pin when
  non-write surfaces need session logs.

## Acceptance criteria

- [x] A completed write-loop iteration leaves exactly one session log file under the
      injected sessions dir containing the harness line, the outbound prompt, the agent's
      stdout/stderr, and a settle `harness` line naming the `completed` outcome.
- [x] The session log file exists and contains the harness + outbound lines before the
      agent binding settles (observable from a binding stub that stats/reads the file
      during `invoke`).
- [x] A second iteration of the same run writes a second, distinct session log file (no
      filename collision when both iterations land in the same second).
- [x] An iteration that times out leaves a closed session log containing its harness +
      outbound lines and a settle `harness` line naming the `timeout` outcome.
- [x] An iteration whose `executeWrite` throws, and an aborted (paused/killed) iteration,
      each leave a closed session log whose settle `harness` line names the `error` /
      `abort` outcome.
- [x] Existing `write-loop.test.ts` and `write.test.ts` stay green (session logging is
      additive to loop outcomes).

## Documentation updates

- `v2/docs/daemon-host.md`: where invocation session logs live
  (`~/.jarvis/sessions/<run-id>-<timestamp>.log`), one per write-loop iteration, and their
  relationship to the structured log stream.
- `v2/docs/first-workflow-walkthrough.md`: a recovery step under observation — when a run
  stalls or fails before structured events accrue, read the invocation session log.
- `v2/docs/invocation-liveness.md`: cross-reference the session log as the first artifact
  to read when a run hangs.
- `v2/docs/v1-behaviors.md`: record v2 session-log parity — v1 writes one session log per
  run; v2 writes one per write-loop iteration, same tag set and line format.
