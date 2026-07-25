---
name: run-list-reports-active-agent-binding
---

# Daemon run list reports the resolved agent and model for the active attempt

`jarvis run list` exposes status and workflow metadata but not which agent/model binding the
active attempt is using. Operators discover `adapterModel` only from `telemetry.jsonl` after
the run finishes — too late when debugging a rung change that did not apply.

## Decisions

- Daemon `list` run objects expose wire fields `agent` and `model` for the active attempt’s resolved binding; rules out RPC-only visibility with no structured fields and rules out alternate field names.
- `jarvis run list` extends the existing tab-separated row with `agent` and `model` columns (same contract surface as `write-behavior.md`); rules out rendering that requires reading telemetry or omits stable column positions.
- Fields reflect the binding actually used or about to be used for the current attempt, not merely the first snapshot write; rules out showing a stale label while a retry is in flight.
- Deferred to first consumer: row-level “diverges from current profile” flag if a deliberate replay path is added later — pin when replay opt-out ships.

## Acceptance criteria

- [ ] `jarvis run list` (daemon `list` wire) includes agent and model for the active attempt on each run row; a test removes either field and fails.
- [ ] CLI list rendering surfaces the same agent/model without reading telemetry; removing the rendered fields fails the test.

## Documentation updates

- `v2/docs/v1-behaviors.md` — daemon `list` and CLI `run list` agent/model fields.
- `v2/docs/daemon-host.md` — `list` RPC row `agent` / `model` fields.
- `v2/docs/write-behavior.md` — tab-separated `run list` column contract.
- `v2/docs/agent-model-config.md` — confirm which rungs a live run is using via `jarvis run list`.
- `v2/docs/operator-runbook.md` — list row agent/model fields; no telemetry required for binding check.

## Prerequisites

- Daemon `list` returns durable run rows with status and per-run workflow metadata.
- Snapshot continuation re-resolves agent binding from the current machine profile for the active attempt (not the persisted snapshot binding); land `snapshot-continue-resolves-current-agent-binding` before planning or implementing this intent.
