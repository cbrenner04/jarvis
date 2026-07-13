## Verdict — fixes required

**1. `write-loop.test.ts` must not write to the operator's real `~/.jarvis/sessions/` directory.**

`write-loop.ts` opens a session log unconditionally each iteration via `openSessionLog(runId, ..., { ...(args.sessionsDir !== undefined ? { sessionsDir: args.sessionsDir } : {}), clock })`. `write-loop.test.ts` never sets `args.sessionsDir`, so every test in that file falls through to the writer's default sessions dir — the operator's real `~/.jarvis/sessions/`. This violates the spec's own injectability requirement (subspec 01, decision: "Sessions dir and clock are write-loop inputs, defaulting to `~/.jarvis/sessions/` and the system clock — rules out deriving the path from `$HOME` inside the loop, which forces tests to write into the operator's real sessions dir"). The new `write-loop-session-log.test.ts` already establishes the correct pattern (a temp `sessionsDir` derived from a test-local root plus a fixed clock) — apply that same pattern to the pre-existing calls to `executeWriteLoop` in `write-loop.test.ts` so no test run pollutes the real sessions directory.

**2. `v2/docs/shared-invocation.md` must not claim no v2 caller wires the session-log writer in.**

The doc states "No v2 caller wires this in yet; the writer is invoked directly in tests until a real caller opens a file." This became false once subspec 01 landed: `write-loop.ts` is now a real caller of `openSessionLog`. Fix the doc to reflect that `write-loop.ts` is the caller (a pointer to `v2/docs/daemon-host.md` for the write-loop-level contract is sufficient), so the documentation accurately describes current behavior rather than the pre-01 state.

Both fixes are narrow and within the existing subspecs' scope — no spec or index edits, no new decisions.