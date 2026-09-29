---
name: roll-and-retain-monthly-telemetry
---

# Roll telemetry monthly and retain closed months

## Problem

Every telemetry producer appends forever to `~/.jarvis/telemetry.jsonl`, so the analysis-fact store grows without a closed-month boundary.

## Behavior

All telemetry producers append the current UTC month to `telemetry.jsonl`. Before an append, a restarted writer determines the existing current file's month from its UTC mtime; when it differs from the clock month, it closes that file as `telemetry/<mtime YYYY-MM>.jsonl.gz` and starts a new current file. Skipped months produce no archive. Closed months are retained, never included in cleanup deletion, and remain readable with standard gzip tooling. Sink path and clock remain injectable.

## Primary implementation surface

- Telemetry JSONL persistence shared by invocation and work-boundary emitters.

## Acceptance criteria

- [ ] Telemetry-sink tests with an injected clock and `JARVIS_HOME` fail against the unbounded sink and pin same-month append, one-time boundary roll, restarted and skipped-month rolls named from the current file's UTC mtime, gzip contents, closed-month retention, and both record kinds using the same rolling behavior.
- [ ] Cleanup tests pin that closed telemetry archives are never deleted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — current-file and closed-month layout, rolling boundary, retention, and injected-sink contract.
- `v2/docs/operator-runbook.md` — read current and compressed historical telemetry.
- `v2/docs/v1-behaviors.md` — record monthly rolling and indefinite retention.

## Prerequisites

- Cleanup keeps hot session logs plain, gzips eligible terminal or orphan logs after `hotDays`, deletes their cold form after `coldDays`, preserves non-terminal logs, and reports per-tier dry-run counts and bytes.
