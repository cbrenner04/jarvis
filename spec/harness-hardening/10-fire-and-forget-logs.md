# 10 — Fire-and-forget log shipping

## Problem

`fanout` in `src/modes/patch/run.ts` awaits `logClient.send(...)` for
every line it ships. The session log on disk is the authoritative record;
the log server is observability only. A slow or stalled log server
backpressures the iteration. Agent output is thousands of lines per
iteration; even a 50ms-slow log server adds tens of seconds of latency
per iteration.

## Behavior

- The initial `logClient.assertReachable()` check stays. The harness still
  refuses to start without a reachable log server. This catches "you
  forgot to start `jarvis log-server`" with a clear error.
- After the connectivity check, `sendLog` becomes fire-and-forget:

  ```ts
  void logClient.send(message).catch(() => {});
  ```

- `fanout` no longer awaits `sendLog`. Session-log writes (`writeSessionLine`)
  remain synchronous since they are the authoritative record.
- Lines may arrive at the log server out of order or be silently dropped
  under load. This is acceptable for a live tail; the on-disk log is
  intact.
- No new config keys. The behavior change is invisible to users in the
  happy path and visibly faster when the log server is slow.

## Tasks

- [ ] Remove `await` from `sendLog` invocations inside `fanout`. Use
      `void promise.catch(() => {})` to swallow rejections.
- [ ] Keep `assertReachable` as a startup gate.
- [ ] Tests: a synthetic log client that delays 500ms per send does not
      delay the iteration; a log client that throws on every send does
      not affect run exit code.

## Acceptance criteria

- [ ] An iteration's wall-clock time is unaffected by log-server latency
      after startup (verified by a test using a delayed mock client).
- [ ] A log-server that throws on every send does not change run exit
      codes.
- [ ] The startup `assertReachable` failure path still exits the run
      with a clear error.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: brief note that log-server shipping is best-effort
  after startup; session log on disk is authoritative.
