---
name: notifications-filter-by-project
---

# Notifications wait and list filter by project

## Prerequisites

- Operator incidents carry a `project` field in serialized JSON, matching the run or owning pipeline and `null` when no single owner applies.
- `jarvis notifications wait` blocks until the next owed operator-actionable incident and prints one JSON line on stdout.
- `jarvis notifications list` returns prior incidents from the durable delivery ledger without blocking.
- `--kind` restricts which incident kinds wake `notifications wait` and narrow `notifications list`.

## Module-boundary surface

- CLI: `jarvis notifications wait` and `jarvis notifications list` admission and filtering.

## Problem

A multi-project operator on one shared daemon receives an undifferentiated incident stream. Even with `project` in the payload, every consumer must hand-roll `jq` selection unless the blocking and catch-up surfaces accept `--project`.

## Decision ledger

- `--project <name>` composes with existing `--kind` on `notifications wait` and `notifications list`; rules out mutually exclusive filter flags or a project-only code path.
- Omitting `--project` preserves today's machine-wide visibility; rules out silently scoping the default consumer to one project.
- Project filtering suppresses wake and stdout emission for non-matching incidents only; rules out dropping or mutating ledger rows for filtered-away projects.

## Acceptance criteria

- [ ] The new notifications CLI test `wait filtered by project ignores other projects` arms `notifications wait --project <name>` and asserts an incident from another project does not wake it; it fails against the pre-fix unfiltered wait.
- [ ] The new notifications CLI test `wait filtered by project wakes on own project` arms `notifications wait --project <name>` and asserts a matching incident returns on stdout; it fails against the pre-fix behavior or the ignore-only case above.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Operator notifications: filtering a shared daemon's incident stream to your own project with `--project`.
