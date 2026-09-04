# Notifications CLI project filter

## Problem

A multi-project operator on one shared daemon receives an undifferentiated incident stream. `project` is already on each serialized incident, but `jarvis notifications wait` and `list` expose only `--since` and `--kind`, so every consumer must hand-roll `jq` unless the CLI accepts `--project`.

## Decision ledger

- `--project <name>` composes with existing `--kind` on `notifications wait` and `notifications list`; rules out mutually exclusive filter flags or a project-only code path.
- Omitting `--project` preserves today's machine-wide visibility; rules out silently scoping the default consumer to one project.
- Project filtering suppresses wake and stdout emission for non-matching incidents only; rules out dropping or mutating ledger rows for filtered-away projects.
- Filtering is CLI admission on RPC `incident.project` payloads; rules out daemon RPC or persistence contract changes in this subspec.
- `--project` matches the serialized `project` string exactly; `null` never matches a named filter; rules out prefix/substring match or treating `null` as a wildcard.
- Missing or empty `--project` exits `1` with `invalid_project: invalid value` before any notification RPC; rules out silent ignore (mirror `run list --project`).
- `notifications wait --project`: when a delivery's `incident.project` does not match, advance `--since` to the returned `deliveryCursor` and re-arm `notification_wait` without stdout; rules out returning non-matching incidents to the operator.

## Prerequisites

- Operator incidents carry `project` on serialized JSON (`v2/src/daemon/operator-incidents.ts`, `NotificationDeliveryIncident.project`).
- `jarvis notifications wait` and `list` delegate to daemon `notification_wait` / `notification_list` with `--since` and `--kind` (`v2/src/commands/notifications.ts`).

## Task checklist

- Add `--project` to `NOTIFICATIONS_PARSE_ARG_OPTIONS`, `NOTIFICATIONS_*_USAGE`, and `NOTIFICATIONS_HELP_FLAGS`.
- Parse `--project` in `parseNotificationArgv`; reject empty values with `invalid_project: invalid value\n` before RPC.
- `notifications list`: after `notification_list`, print only incidents whose `project` equals the filter when `--project` is set.
- `notifications wait`: when `--project` is set, loop on `notification_wait` — skip stdout and re-arm with `deliveryCursor` as the next `--since` bound until a matching incident or RPC error.
- Add mixed-project test fixtures in `notifications.test.ts` (distinct registered project names on seeded runs).
- Add empty `--project` guard tests mirroring `run-list-dimension-filters.test.ts` (`invalid_project` before RPC).
- Add wait catch-up `--project` test mirroring `notifications wait since cursor returns delivery recorded while no waiter was armed`.
- Add null-`project` fixtures; assert named `--project` never matches `project: null`.

## Acceptance criteria

- [x] `v2/src/commands/notifications.test.ts` test `empty --project exits 1 with invalid_project and skips notification RPC` asserts `notifications wait --project ""` and `notifications list --project ""` exit `1` with `invalid_project: invalid value\n` on stderr, empty stdout, and no notification RPC; it fails against the pre-fix behavior (mirror `run-list-dimension-filters.test.ts`).
- [x] `v2/src/commands/notifications.test.ts` test `wait filtered by project ignores other projects` arms `notifications wait --project <name>`, delivers an incident for another project first with no stdout wake, then a matching one, and asserts only the matching incident wakes wait; it fails against the pre-fix unfiltered wait.
- [x] `v2/src/commands/notifications.test.ts` test `wait filtered by project since cursor returns matching delivery recorded while no waiter was armed` records a non-matching-project delivery and a matching one, arms `notifications wait --project <name> --since <prior cursor>`, and asserts only the matching incident is returned; it fails against the pre-fix unfiltered wait or wait that filters only on the blocking wake path.
- [x] `v2/src/commands/notifications.test.ts` test `wait filtered by project wakes on own project` arms `notifications wait --project <name>` and asserts a matching incident returns on stdout; it fails against the pre-fix behavior or the ignore-only case above.
- [x] `v2/src/commands/notifications.test.ts` test `wait and list filtered by project ignore null-project incidents` arms wait/list with `--project <name>` against fixtures whose `project` is `null` and asserts no stdout wake or list rows; it fails against the pre-fix unfiltered behavior.
- [x] `v2/src/commands/notifications.test.ts` test `list filtered by project narrows ledger output` arms `notifications list --project <name>` against a mixed-project ledger and asserts only matching-project rows are returned; it fails against the pre-fix unfiltered list.
- [x] `v2/src/commands/notifications.test.ts` test `wait and list accept project and kind together` arms `--project` with `--kind` on wait and list and asserts only incidents matching both filters wake or print; it fails against the pre-fix behavior.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None in this subspec; operator runbook alignment is subspec 01.
