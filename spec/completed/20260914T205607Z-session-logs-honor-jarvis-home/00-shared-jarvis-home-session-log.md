# 00 — Shared `jarvisHome()` and session-log default

`shared/invocation/session-log.ts:18` resolves `join(homedir(), ".jarvis", "sessions")`, bypassing `JARVIS_HOME`; `jarvisHome()` lives in `v2/src/paths.ts`, which `shared/**` cannot import.

## Decisions

- New `shared/paths.ts` owns `jarvisHome()`; rules out a second, session-log-local resolver (it would defeat the guard in 01).
- `v2/src/paths.ts` re-exports `jarvisHome` from the shared resolver; rules out rewriting every v2 call site.
- `defaultSessionsDir()` resolves lazily at call time, not at module load; the test preload sets `JARVIS_HOME` and tests may override it per case.

## Acceptance criteria

- [x] `shared/paths.ts` exports `jarvisHome()` honoring `JARVIS_HOME`, falling back to the home-dir default.
- [x] `v2/src/paths.ts` re-exports `jarvisHome` instead of defining it.
- [x] `openSessionLog` without `sessionsDir` writes under `join(jarvisHome(), "sessions")`; a new test in `shared/invocation/session-log.test.ts` sets `JARVIS_HOME` to a temp dir and asserts the log lands there; it fails against the pre-fix code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: internal resolver move; docs land in 02.
