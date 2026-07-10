---
name: v2-first-workflow-walkthrough
description: End-to-end quickstart running a first v2 workflow and observing it to a draft PR
---

# Onboarding: your first v2 workflow

A hands-on quickstart that walks a configured new user through running one v2
workflow end-to-end and observing it, so the first real run is guided rather than
guessed. Ends at a draft PR the reader can inspect.

Covers:

- Starting a run against a spec (`jarvis run start`) and the run lifecycle a user sees.
- Observing the run: live state and structured log via the TUI (`jarvis tui`, `jarvis tui log <run-id>`) and `jarvis run list|log`.
- Steering: pause/resume/kill at a boundary, and `jarvis run wait`.
- The output: worktree → branch → draft PR with attribution, and where to find it.

A single happy-path walkthrough with the real commands and expected output, not a
full command reference.

## Prerequisites

- v2 `jarvis` is installed and configured (agents/models set, daemon startable).
- Starting a run against a spec via the daemon exists (`jarvis run start`).
- Observing a run's live state and structured log via the TUI exists.
- A completed v2 run produces a draft PR with per-commit attribution.
