# Document v1-behaviors session-log retention

## Problem

`v2/docs/v1-behaviors.md` catalogs v2 cleanup slices through daemon-socket reaping but omits session-log retention, so parity review cannot see v1 divergence.

## Decision ledger

- Record session-log retention as **[v2 additive]** with source paths; rules out implying v1 `jarvis1 cleanup` reaps `~/.jarvis/sessions/`.
- One bullet covers window, terminal finish-time guard, scope limit to direct session `.log` files, and aggregate reporting; rules out restating the full cleanup command from the operator runbook.

## Prerequisites

- Subspec 01: session-log retention behavior.

## Task checklist

- Add a **[v2 additive]** entry to `v2/docs/v1-behaviors.md` for cleanup session-log retention: 14-day default, `cleanup.sessionLogRetentionDays` override, terminal `finishedAt` eligibility, direct `.log`-only scope under `~/.jarvis/sessions/`, invalid-config slice refusal, aggregate dry-run/apply summaries, and explicit v1 non-behavior.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` records v2 session-log retention and states v1 cleanup does not reap session logs, consistent with subspec 01.

## Documentation updates

- None beyond the acceptance criterion above.
