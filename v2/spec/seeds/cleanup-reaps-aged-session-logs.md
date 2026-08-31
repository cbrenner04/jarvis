# `jarvis cleanup` reaps aged session logs — `~/.jarvis/sessions/` grows to ~830K files unbounded

## Problem

`~/.jarvis/sessions/` holds one `.log` per agent invocation and is never reaped: observed 2026-08-31 at **833,785 files / 6.2 GB**, oldest dating to 2026-05-11. This is the dominant `~/.jarvis` disk and inode consumer — a single directory with ~830K entries makes `ls`/`du` there crawl (a `du sessions/*` took >2 min). Session logs are raw agent I/O; their value decays fast (post-mortem is always of recent runs). `jarvis run log` replays from the state store (`~/.jarvis/state/v2.sqlite`), NOT from `sessions/`, so aged session logs are recoverable dead weight.

## Decisions

- Add a `jarvis cleanup` slice that reaps session `.log` files for terminally-settled runs older than a retention window (default **14 days**; make it config-tunable). Confirm during design that `run log`/replay never reads `sessions/` (state store is the source), so reaping does not break log reads. Rules out unbounded session-dir growth.
- Guard: never reap a session log for a live or non-terminal run — key retention on the owning run's terminal finish time, not the file mtime alone where they differ. Rules out deleting an in-flight run's transcript.
- Report reaped counts in cleanup stdout and `--dry-run` preview; do not print 830K filenames — summarize (count + reclaimed bytes + oldest-kept date). Rules out both silent deletion and an unusable preview.
- **Do NOT extend this to `telemetry.jsonl` or state-store run rows.** Both back `v2/docs/research/` — the research reproduction scripts read the whole live `telemetry.jsonl` (era from 2026-07-12) and join `runs`/`pipelines`/`pipeline_stages` in `v2.sqlite`. Purging or rotating either would silently break the analyses. `telemetry.jsonl` is only ~148 MB; leave it whole. Rules out a well-meaning implementer folding the research dataset into this retention pass.

## Acceptance criteria

- [ ] A cleanup test proves session `.log` files for terminal runs older than the window are removed, recent ones and any live/non-terminal run's log are preserved; it fails against the pre-fix no-reap.
- [ ] `--dry-run` reports the count and reclaimed bytes it would reap without deleting, and does not enumerate every file.
- [ ] A test (or explicit guard) pins that the slice touches only `~/.jarvis/sessions/` — never `telemetry.jsonl` or `state/v2.sqlite`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the cleanup section documents session-log retention (window, terminal-run guard, and the explicit telemetry/state-store exclusion for research).

## Sequencing

P2 — real disk + inode pressure (830K files), higher impact than the KB-scale daemon-file reaping. Cheap and independent; pairs with [[cleanup-reaps-dead-daemon-log-and-pid-files]] and [[cleanup-improvements]]. Telemetry rotation is explicitly out of scope (research dependency); revisit only if telemetry grows large, and then archive-not-delete plus update the research scripts.
