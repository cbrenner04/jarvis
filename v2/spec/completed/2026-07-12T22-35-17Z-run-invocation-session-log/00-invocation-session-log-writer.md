# 00 - Invocation session-log writer

`shared/invocation/execute.ts` spawns the agent subprocess and buffers stdout/stderr in
memory. Nothing is written to disk until structured records accrue, so a stalled or
hard-failed invocation leaves no on-disk evidence the subprocess ran. Add a session-log
seam owned by the invocation layer: a file-backed writer plus optional `sessionLog`
plumbing through `executeWithQuotaFallback` and `runStep`.

Within one log, each binding attempt in the fallback chain appends its own
`harness` + `outbound` + `inbound_*` lines. No v2 caller is wired here —
[01](./01-write-loop-session-log.md) opens the real file.

## Decisions

- Session-log writer lives in `shared/invocation/session-log.ts` — rules out reusing
  `v1/src/config.ts`'s `openSessionLog`, which `shared/**` may not import.
- Sessions dir and clock are injectable, defaulting to `~/.jarvis/sessions/` and the
  system clock — rules out tests writing into the operator's real sessions dir.
- Tags and line format mirror v1 (`<ISO ts> [<tag>] <line>`, tags `harness`, `outbound`,
  `inbound_stdout`, `inbound_stderr`) — rules out inventing a new transcript format.
- Appends are unbuffered (synchronous write-through to the fd) — rules out buffered
  writes, under which a killed process or a mid-invoke reader sees an empty file.
- `executeWithQuotaFallback` writes `harness` (binding id, agent, model) and `outbound`
  (prompt) **before** calling `binding.invoke`, and `inbound_stdout`/`inbound_stderr`
  after the binding settles, for every binding attempt in the fallback chain — rules out
  writing only the final attempt, and rules out writing everything post-settle (which
  would leave a stalled invocation with an empty file).
- Non-`ok` results write their `stderr` under `inbound_stderr` — rules out dropping
  quota/`model_config`/`error` diagnostics from the transcript.
- Appends after `close()` are dropped silently and `close()` is idempotent — rules out
  writing to a closed/recycled descriptor when a caller closes on timeout/abort while the
  invocation is still in flight, and rules out having `close()` await that possibly-stalled
  invocation.
- Writer append, open, and directory-creation failures are swallowed: the writer degrades
  to a no-op sink and the invocation proceeds — rules out failing a run over an
  observability feature (the log opens before the spawn, so an unwritable sessions dir
  would otherwise block work).
- The writer does not own file lifetime beyond `close()`; the caller opens and closes.

## Acceptance criteria

- [x] Opening a session log for namespace + timestamp creates
      `<sessionsDir>/<namespace>-<timestamp>.log`, creating the directory when absent.
- [x] Each written line is `<ISO-8601 ts> [<tag>] <text>` with multi-line text split into
      one stamped line per source line, and is readable from another process/handle
      immediately after the append returns.
- [x] Appends after `close()` are dropped (no throw, no file growth); a second `close()`
      is a no-op.
- [x] An unwritable sessions dir (open or mkdir fails) yields a writer whose writes are
      no-ops; `executeWithQuotaFallback` returns its normal result.
- [x] With a session log attached, `executeWithQuotaFallback` writes the binding's
      `harness` line and the `outbound` prompt before the binding is invoked (observable
      from inside a binding stub that reads the log mid-invoke).
- [x] With a session log attached, a settled `ok` binding writes its stdout under
      `inbound_stdout` and its stderr under `inbound_stderr`.
- [x] A `quota`, `model_config`, or `error` binding result writes its diagnostics under
      `inbound_stderr`, and a subsequent fallback binding attempt writes its own `harness`
      + `outbound` lines to the same log.
- [x] A writer whose append throws does not fail the invocation; the invocation result is
      unchanged.
- [x] `executeWithQuotaFallback` and `runStep` with no `sessionLog` behave exactly as
      before: `execute.test.ts` and `step-runner.test.ts` stay green.

## Documentation updates

- `v2/docs/shared-invocation.md`: document the session-log seam — what the invocation
  layer writes, when (before spawn vs at settle), the tag set, and post-close behavior.
- `v2/docs/shared-step-runner.md`: the optional `sessionLog` field on `runStep`'s input.
