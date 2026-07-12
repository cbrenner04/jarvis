# 00 - Invocation session-log writer

`shared/invocation/execute.ts` spawns the agent subprocess and buffers stdout/stderr in
memory. Nothing is written to disk until structured records accrue, so a stalled or
hard-failed invocation leaves no on-disk evidence the subprocess ran. Add a session-log
seam owned by the invocation layer: a file-backed writer plus optional `sessionLog`
plumbing through `executeWithQuotaFallback` and `runStep`.

No v2 caller is wired here — [01](./01-write-loop-session-log.md) opens the real file.

## Decisions

- Session-log writer lives in `shared/invocation/session-log.ts` — rules out reusing
  `v1/src/config.ts`'s `openSessionLog`, which `shared/**` may not import.
- Sessions dir is injectable, defaulting to `~/.jarvis/sessions/` — rules out tests
  writing into the operator's real sessions dir.
- Tags and line format mirror v1 (`<ISO ts> [<tag>] <line>`, tags `harness`, `outbound`,
  `inbound_stdout`, `inbound_stderr`) — rules out inventing a new transcript format.
- `executeWithQuotaFallback` writes `harness` (binding id, agent, model) and `outbound`
  (prompt) **before** calling `binding.invoke`, and `inbound_stdout`/`inbound_stderr`
  after the binding settles, for every attempt in the fallback chain — rules out
  writing only the final attempt, and rules out writing everything post-settle (which
  would leave a stalled invocation with an empty file).
- Non-`ok` results write their `stderr` under `inbound_stderr` — rules out dropping
  quota/`model_config`/`error` diagnostics from the transcript.
- Writer append failures are swallowed — rules out a full disk failing an invocation.
- The writer does not own file lifetime beyond `close()`; the caller opens and closes.

## Acceptance criteria

- [ ] Opening a session log for namespace + timestamp creates
      `<sessionsDir>/<namespace>-<timestamp>.log`, creating the directory when absent.
- [ ] Each written line is `<ISO-8601 ts> [<tag>] <text>` with multi-line text split into
      one stamped line per source line.
- [ ] With a session log attached, `executeWithQuotaFallback` writes the binding's
      `harness` line and the `outbound` prompt before the binding is invoked (observable
      from inside a binding stub that reads the log mid-invoke).
- [ ] With a session log attached, a settled `ok` binding writes its stdout under
      `inbound_stdout` and its stderr under `inbound_stderr`.
- [ ] A `quota`, `model_config`, or `error` binding result writes its diagnostics under
      `inbound_stderr`, and a subsequent fallback binding writes its own `harness` +
      `outbound` lines to the same log.
- [ ] A writer whose append throws does not fail the invocation; the invocation result is
      unchanged.
- [ ] `executeWithQuotaFallback` and `runStep` with no `sessionLog` behave exactly as
      before: `execute.test.ts` and `step-runner.test.ts` stay green.

## Documentation updates

- `v2/docs/shared-invocation.md`: document the session-log seam — what the invocation
  layer writes, when (before spawn vs at settle), and the tag set.
