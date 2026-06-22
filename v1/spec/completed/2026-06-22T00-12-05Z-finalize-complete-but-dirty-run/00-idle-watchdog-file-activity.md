# 00 - Idle watchdog: file-activity liveness + reusable arm helper

## Problem

The idle-output watchdog (`v1/src/modes/patch/iteration.ts`, the `scheduleIdleCheck` loop armed when `cfg.idleOutputTimeoutMs !== undefined`) measures liveness as stdout/stderr only. Run #346 implemented a full subspec — gate logic, seam wiring, 242 lines of tests — with **zero stdout** (`last_output_age_ms=null`); a 5-min idle watchdog killed it mid-work twice (haiku and sonnet identically). Stdout-only liveness cannot tell a productive-but-silent agent from a genuine hang.

The agent is alive and editing files the whole time. Most-recent file mtime under the agent working tree is the missing liveness signal. Make the watchdog fire only when there is **neither** recent output **nor** recent file activity, and extract the armed watchdog into a reusable helper so later phases (subspecs 03–04) share one calibrated implementation.

This subspec keeps the watchdog default-off (`idleOutputTimeoutMs` unset → not armed). Defaulting it on is subspec 01.

### Residual boundaries (file activity narrows but does not close the gap)

State these explicitly so implementer and reviewer share the real contract:

- **Silent + no-write work still false-kills.** A long read-only or buffered-output operation (e.g. a big test run with buffered stdout) writes no files and reads as fully idle; #346 was saved only because it *wrote* files. The 600000 ms default (subspec 01) is the acknowledged compromise for this residual class — file activity does not remove the risk.
- **File-noisy hang never idle-kills.** A hung agent whose child keeps appending to a worktree file shows fresh mtime forever; the wall-clock `iterationTimeoutMs` still catches it. The idle watchdog catches only stalls with neither output nor file activity (the intent's "any silent stall" narrows to this).

## Decisions

- Effective last-activity = `max(lastOutputAt, lastFileActivityAt, armedAt)`; watchdog fires only when `now - effective >= idleOutputTimeoutMs`. Rules out the current stdout-only condition that false-killed #346.
- File activity = most-recent file mtime within the agent working tree. Rules out reusing `watchdog_descendants_alive` as the liveness proxy — a hung agent's process stays alive, so process liveness never detects a hang.
- Exclude `.git/` internal churn from the mtime scan. Rules out lock-file/index writes registering as agent work and masking a real hang.
- Sample file mtime only on the cheap path — when output is already stale and the watchdog is about to fire — not on every 100 ms poll. Rules out a full-tree stat storm each poll.
- Extract the armed watchdog into a reusable helper (e.g. `armIdleWatchdog`) in a shared module. The helper takes **output-age, file-activity, and the working-directory to scan as explicit inputs supplied by the caller** — not ambient/assumed constants. Rules out a helper that implicitly reads the patch path's `lastOutputAtMs` ref (which exists only in the patch invocation binding); review/shrink/plan spawn through different bindings with no such ref, so making these inputs explicit is what lets subspecs 03–04 reuse it.
- Writes to gitignored paths **count as file activity**. Rules out a `git status`-based mtime scan that excludes ignored files and would false-kill an agent writing to an ignored build/output dir; the scan must include working-tree writes regardless of ignore status (only `.git/` internals are excluded). This pins the requirement; the scan mechanism stays deferred.
- Exit code (`8`), `exitReason: "watchdog-idle-timeout"`, the `[watchdog] idle timeout fired after <ms>ms` line, and not-quota classification are unchanged.

Deferred to first consumer: mtime scan mechanism (recursive walk vs other read) — pin in implementation when wiring the cheap path; must include gitignored working-tree writes per the decision above.

## Task checklist

- [ ] Add file-activity sampling (most-recent mtime under agent working tree, excluding `.git/`) to the idle watchdog.
- [ ] Change the fire condition to require both output-stale and file-activity-stale past `idleOutputTimeoutMs`.
- [ ] Add `last_file_activity_age_ms` to the `[watchdog]` diagnostic line and watchdog telemetry row (null when no file activity observed).
- [ ] Extract the armed watchdog into a reusable helper taking output-age, file-activity, and scan working-directory as explicit caller-supplied inputs; patch iteration consumes it.
- [ ] Tests: a silent-but-file-editing agent is NOT killed within the idle window; a fully-idle agent (no output, no file writes) still is.

## Acceptance criteria

- [x] An agent producing no stdout/stderr but writing files within the idle window is not aborted; the run continues past `idleOutputTimeoutMs`.
- [x] An agent producing neither stdout/stderr nor file writes for `idleOutputTimeoutMs` is aborted with exit `8` and `exitReason: "watchdog-idle-timeout"`.
- [x] The `[watchdog]` idle line and telemetry row include `last_file_activity_age_ms`.
- [x] `.git/`-only changes (no working-tree file edits) do not count as file activity and do not prevent an idle abort.
- [x] A write to a gitignored working-tree path counts as file activity and prevents an idle abort within the window.
- [x] Existing idle/iteration watchdog tests in `v1/test/run.sandbox-unrunnable.test.ts` stay green (true-hang kill behavior unchanged when there is no file activity).

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": liveness now resets on file activity as well as output; document `last_file_activity_age_ms`.
- `v2/docs/v1-behaviors.md` — idle-watchdog entry/section: kill requires neither output nor file activity; new telemetry field.
