---
name: observability-sinks-honor-jarvis-home-and-cap-blobs
---

# Session logs escape `JARVIS_HOME` and telemetry rows carry megabyte blobs

## Problem

Measured 2026-09-10 on the operator machine. `~/.jarvis/sessions/` held 1.24 million files (9 GB); all but ~4k had run ids absent from the store and headers like `binding=claude/M1 spec=spec.md`: test fixtures. `shared/invocation/session-log.ts` resolves `join(homedir(), ".jarvis", "sessions")` directly instead of `jarvisHome()`, so the test preload's `JARVIS_HOME` does not isolate it and every local test run writes hundreds of files into the real home. Cleanup's session-log reaper (`cleanup.sessionLogRetentionDays`, default 14) never touches them because it requires a terminal run row with `finishedAt`; logs whose run row is gone (purged store, fixtures, v1-era `project:spec` names) live forever. Scanning the directory takes minutes, so every `jarvis cleanup` pays for the leak. Test fixtures also leaked `~/.jarvis/specs/Org-*` and `~/.jarvis/specs/project/tmp-*`.

`~/.jarvis/telemetry.jsonl` held ~11k rows at 330 MB; 320 MB was the `exit_reason` field. ~300 cursor `quota` exits stuffed the whole streamed JSON transcript into the reason string, single rows up to 19 MB. Without the blob the file is ~10 MB. Telemetry is the durable facts ledger (`telemetry-capture.md`); blobs belong in the session log, not the facts row.

## Decisions

- Every operator-home sink resolves through `jarvisHome()`; `homedir()` is not called outside `paths.ts`. A structural test enforces it.
- A test-preload guard fails the suite when any test writes under the real `~/.jarvis` (compare a pre/post snapshot of `sessions/`, `specs/`, and `telemetry.jsonl`, or fence the real home read-only for the test process).
- Telemetry rows cap `exit_reason` and `warnings` at write time (a few KB, tail-truncated with a marker); the full text stays in the session log, which the row already joins to by `run_id`/`attempt_id`.
- The session-log reaper falls back to file mtime against the same retention window when the name does not parse or the run row is gone; a live run row still protects its logs. Reaping is streamed, not `readdirSync`-then-filter, so a large directory does not stall cleanup.
- The bulk purge of the existing leak was operator housekeeping (2026-09-10: 1.24M files moved out by hand). Fixtures leaked before this lands, including ~2k skipped by that purge, are not purged by hand again: the mtime fallback reaps them on the first cleanup after they age past the window.

## Acceptance criteria

- [ ] Running the v2 suite with `JARVIS_HOME` set writes nothing under the real `~/.jarvis`; pinned by the preload guard, which fails against the baseline.
- [ ] `openSessionLog` defaults to `join(jarvisHome(), "sessions")`; pinned by a test that sets `JARVIS_HOME` to a temp dir.
- [ ] A telemetry row whose `exit_reason` exceeds the cap is persisted truncated with a marker and the untruncated text is present in the invocation's session log; pinned by tests.
- [ ] Cleanup reaps an orphan session log older than the window and keeps one younger than it or owned by a non-terminal run; pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:shared`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — field caps and where the full text lives.
- `v2/docs/operator-runbook.md` § Session-log retention — orphan fallback rule.
- `v2/docs/test-writing.md` — the real-home guard and how to inject `sessionsDir`/`sinkPath`.
- `v2/docs/v1-behaviors.md` — record the reaper fallback.
