# 01 - Write loop opens a session log per invocation attempt

Wire the writer from [00](./00-invocation-session-log-writer.md) into v2's write path: each
write-loop invocation attempt opens its own session log before the agent subprocess spawns
and closes it when the invocation settles — including timeout, abort, and thrown-error
paths. After this, an operator whose run stalls has a file on disk showing which agent was
invoked, with what prompt, and how far it got.

## Decisions

- One log file per write-loop invocation attempt, named
  `~/.jarvis/sessions/<namespace>-<timestamp>.log`, where `<namespace>` is the run id —
  rules out one shared file per run and one file per binding in the fallback chain.
- The log is closed in the write loop's iteration-settle path so timeout / abort /
  `executeWrite` throw all close it — rules out closing only on the happy path, which
  would leak descriptors on exactly the failure the log exists for.
- The write loop stamps a `harness` line naming the run, spec, and iteration before the
  step runs — rules out a file whose only pre-spawn content is the prompt.
- Deferred to first consumer: filename slug beyond `<namespace>-<timestamp>` — pin when
  non-write surfaces need session logs.

## Acceptance criteria

- [ ] A completed write-loop iteration leaves exactly one session log file under the
      sessions dir containing the harness line, the outbound prompt, and the agent's
      stdout/stderr.
- [ ] The session log file exists and contains the harness + outbound lines before the
      agent binding settles (observable from a binding stub that stats/reads the file
      during `invoke`).
- [ ] A second iteration of the same run writes a second, distinct session log file.
- [ ] An iteration that times out leaves a session log containing its harness + outbound
      lines, and the log is closed.
- [ ] An iteration whose `executeWrite` throws, and an aborted (paused/killed) iteration,
      each leave a closed session log.
- [ ] Existing `write-loop.test.ts` and `write.test.ts` stay green (session logging is
      additive to loop outcomes).

## Documentation updates

- `v2/docs/daemon-host.md`: where invocation session logs live
  (`~/.jarvis/sessions/<run-id>-<timestamp>.log`), one per invocation attempt, and their
  relationship to the structured log stream.
- `v2/docs/first-workflow-walkthrough.md`: a recovery step under observation — when a run
  stalls or fails before structured events accrue, read the invocation session log.
- `v2/docs/v1-behaviors.md`: record v2 session-log parity — v1 writes one session log per
  run; v2 writes one per write-loop invocation attempt, same tag set and line format.
