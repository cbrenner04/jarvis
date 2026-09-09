# Document operator-runbook session-log retention

## Problem

`v2/docs/operator-runbook.md` § Cleanup lists four slices and never mentions session-log retention, invalid-setting refusal, research-file exclusions, or aggregate dry-run reporting.

## Decision ledger

- § Cleanup: eligibility gate is the durable home for session-log retention operator semantics; rules out duplicating the full command reference in `install-and-config.md`.
- Document the slice as global (not project-scoped) like dead daemon-socket reaping; rules out implying `<project>` filters session logs.
- Align prose with subspec 01 behavior only; rules out documenting dead-daemon `.log`/`.pid` reaping or other cleanup-improvements seeds not in this spec.

## Prerequisites

- Subspec 01: session-log retention behavior and tests.

## Task checklist

- Update `v2/docs/operator-runbook.md` § Cleanup: add session-log retention as a fifth independent slice — retention window (14-day default, `cleanup.sessionLogRetentionDays` override), terminal `finishedAt` eligibility, preserved live/non-terminal/unowned logs, invalid-config refusal for this slice only, explicit exclusion of non-`.log` paths under `~/.jarvis/sessions/` (including decoy `telemetry.jsonl` and `state/v2.sqlite`), and aggregate dry-run/apply summary shape without per-file listing.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` § Cleanup documents session-log retention window, terminal-run finish-time eligibility, invalid `cleanup.sessionLogRetentionDays` refusal, excluded non-`.log` paths under `~/.jarvis/sessions/`, and aggregate dry-run/apply summaries consistent with subspec 01.

## Documentation updates

- None beyond the acceptance criterion above.
