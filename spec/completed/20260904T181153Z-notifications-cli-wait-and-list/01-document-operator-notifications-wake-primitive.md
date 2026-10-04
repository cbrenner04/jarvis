# Document notifications wake primitive

## Problem

`v2/docs/operator-runbook.md` § Operator notifications and § Deciding a workflow is finished steer operators toward sink push and `run list` / `lsof` poll loops when a notification is missed. Landed `jarvis notifications wait` and `list` are the supported pull-side wake primitive but are undocumented in the operator runbook.

## Decision ledger

- `operator-runbook.md` § Operator notifications is the durable home for operator-facing wait/list usage; rules out duplicating full RPC param lists from `daemon-host.md`.
- Cross-link `daemon-host.md` § Operator notifications for ledger cursor wire form and RPC contracts; rules out copying daemon wire details into the runbook.
- § Deciding a workflow is finished names `jarvis notifications wait` as the supported wake primitive for backgrounded work; rules out recommending `run list` loops when a notification was missed.
- § Operator notifications documents wait stdout as `{ incident, deliveryCursor }` and list stdout as incident-only NDJSON; rules out runbook prose that only mirrors sink stdin and omits `deliveryCursor`, which would break operator `--since` chaining guidance.
- Sink push via `notificationSinkCommand` remains documented as the primary push path; wait/list are the pull complement, not a sink replacement.

## Prerequisites

- Subspec 00: `jarvis notifications wait` and `jarvis notifications list` are landed and tested.

## Task checklist

- Update `v2/docs/operator-runbook.md` § Operator notifications: introduce `jarvis notifications wait` (block until next owed incident; stdout `{ incident, deliveryCursor }` with cursor usable as next `--since`; `--since`, `--kind`) and `jarvis notifications list` (incident-only NDJSON catch-up; `--since`, `--kind`); cross-link `daemon-host.md` for cursor and RPC detail.
- Update § Deciding a workflow is finished: `jarvis notifications wait` is the supported wake primitive for backgrounded pipelines/runs; demote `run list` / `lsof` loops to missed-notification diagnosis only (retain existing diagnosis bullets where still accurate).

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` § Operator notifications and § Deciding a workflow is finished document `jarvis notifications wait` as the supported wake primitive (stdout `{ incident, deliveryCursor }`, cursor usable as next `--since`), describe `notifications list` as incident-only NDJSON catch-up, cross-link `daemon-host.md`, and remove guidance to reach for `run list` loops when a notification is missed.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Operator notifications and § Deciding a workflow is finished: `jarvis notifications wait` is the supported wake primitive; remove guidance to reach for `run list` loops when a notification is missed.
