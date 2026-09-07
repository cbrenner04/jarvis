# Document install-and-config session-log retention

## Problem

`v2/docs/install-and-config.md` documents machine-wide write-path keys but not `cleanup.sessionLogRetentionDays`, so operators cannot discover the retention default or validation rules.

## Decision ledger

- Machine-config schema prose for `cleanup.sessionLogRetentionDays` belongs in `install-and-config.md` beside other top-level machine keys; rules out burying the key only in the operator runbook.
- State that invalid values disable session-log reaping for that cleanup invocation without affecting other slices; rules out implying invalid config aborts all of cleanup.

## Prerequisites

- Subspec 00: `readCleanupSessionLogRetentionDays`.
- Subspec 01: invalid-config refusal behavior.

## Task checklist

- Add a `cleanup.sessionLogRetentionDays` entry to the machine-config tables in `v2/docs/install-and-config.md`: positive integer, default 14 when absent, invalid value skips session-log reaping and reports the key.

## Acceptance criteria

- [ ] `v2/docs/install-and-config.md` documents `cleanup.sessionLogRetentionDays` with positive-integer validation, 14-day default when absent, and invalid-value refusal for the session-log slice consistent with subspecs 00–01.

## Documentation updates

- None beyond the acceptance criterion above.
