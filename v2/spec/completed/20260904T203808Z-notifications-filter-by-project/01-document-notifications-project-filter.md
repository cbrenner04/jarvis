# Document notifications project filter

## Problem

`jarvis notifications wait` and `list` accept `--project` after subspec 00, but `v2/docs/operator-runbook.md` § Operator notifications documents only `--since` and `--kind`. Multi-project operators on one shared daemon have no durable guidance for scoping the pull-side wake primitive to their project.

## Decision ledger

- `operator-runbook.md` § Operator notifications is the durable home for `--project` operator semantics; rules out duplicating filter behavior in `daemon-host.md` (ledger and RPC contracts stay there).
- Document that omitting `--project` keeps machine-wide visibility and that `--project` composes with `--kind`; rules out runbook prose implying a default project scope.
- Document that filtering affects wait wake and list stdout only, not sink push or ledger rows; rules out implying filtered incidents are undelivered.

## Prerequisites

- Subspec 00: `jarvis notifications wait` and `list` accept and test `--project`.

## Task checklist

- Update `v2/docs/operator-runbook.md` § Operator notifications: add `--project <name>` to the wait/list usage lines and prose; explain filtering a shared daemon's incident stream to one registered project name, composition with `--kind`, and unchanged behavior when `--project` is omitted.
- Add **[v2 additive]** bullet for `--project` on `notifications wait` and `list` to `v2/docs/v1-behaviors.md` (mirror `run list --project` at L31).

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` § Operator notifications documents `--project` on `jarvis notifications wait` and `list` (exact project-name filter composable with `--kind`, machine-wide when omitted, stdout/wake only — no ledger suppression).
- [x] `v2/docs/v1-behaviors.md` catalogs `--project` on `jarvis notifications wait` and `list` as **[v2 additive]** (exact project-name match, composes with `--kind`, machine-wide when omitted, invalid empty `--project` exits `1` with `invalid_project: invalid value` before any notification RPC, stdout/wake filtering only — no ledger suppression).

## Documentation updates

- `v2/docs/operator-runbook.md` — § Operator notifications: filtering a shared daemon's incident stream to your own project with `--project`.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** `--project` on `notifications wait` and `list`.
