# 00 - Idle watchdog: file-activity liveness + reusable arm helper

## Problem

The idle-output watchdog (`v1/src/modes/patch/iteration.ts`, the `scheduleIdleCheck` loop armed when `cfg.idleOutputTimeoutMs !== undefined`) measures liveness as stdout/stderr only. Run #346 implemented a full subspec — gate logic, seam wiring, 242 lines of tests — with **zero stdout** (`last_output_age_ms=null`); a 5-min idle watchdog killed it mid-work twice (haiku and sonnet identically). Stdout-only liveness cannot tell a productive-but-silent agent from a genuine hang.

The agent is alive and editing files the whole time. Most-recent file mtime under the agent working tree is the missing liveness signal. Make the watchdog fire only when there is **neither** recent output **nor** recent file activity, and extract the armed watchdog into a reusable helper so later phases (subspec 03) share one calibrated implementation.

This subspec keeps the watchdog default-off (`idleOutputTimeoutMs` unset → not armed). Defaulting it on is subspec 01.

## Decisions

- Effective last-activity = `max(lastOutputAt, lastFileActivityAt, armedAt)`; watchdog fires only when `now - effective >= idleOutputTimeoutMs`. Rules out the current stdout-only condition that false-killed #346.
- File activity = most-recent file mtime within the agent working tree. Rules out reusing `watchdog_descendants_alive` as the liveness proxy — a hung agent's process stays alive, so process liveness never detects a hang.
- Exclude `.git/` internal churn from the mtime scan. Rules out lock-file/index writes registering as agent work and masking a real hang.
- Sample file mtime only on the cheap path — when output is already stale and the watchdog is about to fire — not on every 100 ms poll. Rules out a full-tree stat storm each poll.
- Extract the armed watchdog into a reusable helper (e.g. `armIdleWatchdog`) in a shared module; patch iteration calls it. Rules out leaving the logic inline, which would force subspec 03 to copy-paste it into each phase.
- Exit code (`8`), `exitReason: "watchdog-idle-timeout"`, the `[watchdog] idle timeout fired after <ms>ms` line, and not-quota classification are unchanged.

Deferred to first consumer: mtime scan mechanism (recursive walk vs `git status -z` mtime read) — pin in implementation when wiring the cheap path.

## Task checklist

- [ ] Add file-activity sampling (most-recent mtime under agent working tree, excluding `.git/`) to the idle watchdog.
- [ ] Change the fire condition to require both output-stale and file-activity-stale past `idleOutputTimeoutMs`.
- [ ] Add `last_file_activity_age_ms` to the `[watchdog]` diagnostic line and watchdog telemetry row (null when no file activity observed).
- [ ] Extract the armed watchdog into a reusable helper; patch iteration consumes it.
- [ ] Tests: a silent-but-file-editing agent is NOT killed within the idle window; a fully-idle agent (no output, no file writes) still is.

## Acceptance criteria

- [ ] An agent producing no stdout/stderr but writing files within the idle window is not aborted; the run continues past `idleOutputTimeoutMs`.
- [ ] An agent producing neither stdout/stderr nor file writes for `idleOutputTimeoutMs` is aborted with exit `8` and `exitReason: "watchdog-idle-timeout"`.
- [ ] The `[watchdog]` idle line and telemetry row include `last_file_activity_age_ms`.
- [ ] `.git/`-only changes (no working-tree file edits) do not count as file activity and do not prevent an idle abort.
- [ ] Existing idle/iteration watchdog tests in `v1/test/run.sandbox-unrunnable.test.ts` stay green (true-hang kill behavior unchanged when there is no file activity).

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": liveness now resets on file activity as well as output; document `last_file_activity_age_ms`.
- `v2/docs/v1-behaviors.md` — idle-watchdog entry/section: kill requires neither output nor file activity; new telemetry field.
