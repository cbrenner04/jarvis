---
name: session-logs-honor-jarvis-home
---

# Operator-home sinks honor `JARVIS_HOME` and tests cannot write the real home

`shared/invocation/session-log.ts` resolves `join(homedir(), ".jarvis", "sessions")` instead of `jarvisHome()`, so the test preload's `JARVIS_HOME` does not isolate it; tests leaked ~1.24M files into `~/.jarvis/sessions/` plus `~/.jarvis/specs/Org-*` and `specs/project/tmp-*`.

## Decisions

- `jarvisHome()` currently lives only in `v2/src/paths.ts`, unreachable from `shared/**` (which must not import `v2/**`). Move its resolver to a new `shared/paths.ts`; `v2/src/paths.ts` re-exports it so existing `v2` call sites are untouched.
- Every jarvis-home sink (session logs, telemetry, specs, state) resolves through the shared `jarvisHome()`. The structural guard is scoped to jarvis-home resolution specifically: it flags `homedir()` calls feeding a `.jarvis` path outside `shared/paths.ts`, not unrelated `homedir()` use for other tools' homes (e.g. `shared/invocation/agents.ts`'s `.codex` sessions dir stays exempt).
- A test-preload guard fails the suite when any test writes under the real `~/.jarvis` (pre/post snapshot of `sessions/`, `specs/`, `telemetry.jsonl`, or read-only fence).

## Acceptance criteria

- [ ] `openSessionLog` defaults to `join(jarvisHome(), "sessions")`; pinned by a test setting `JARVIS_HOME` to a temp dir.
- [ ] A structural test fails when a `.jarvis`-path `homedir()` call exists outside `shared/paths.ts`, and does not flag `shared/invocation/agents.ts`'s `.codex` resolver.
- [ ] Running the v2 suite with `JARVIS_HOME` set writes nothing under the real `~/.jarvis`; pinned by the preload guard, which fails against the baseline.

## Documentation updates

- `v2/docs/test-writing.md` — the real-home guard and how to inject `sessionsDir`/`sinkPath`.

## Prerequisites
