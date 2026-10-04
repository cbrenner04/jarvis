# Operator docs for `run start` retirement

## Primary implementation surface

- `v2/docs/first-workflow-walkthrough.md`
- `v2/docs/install-and-config.md`
- `v2/docs/operator-runbook.md`
- `v2/docs/write-behavior.md`
- `v2/docs/v1-behaviors.md`
- `v2/docs/prompts.md`, `v2/docs/daemon-host.md` when they still mention `run start` after the code cut

## Problem

Operator docs still teach ad-hoc `run start` for kill demos, timeout keys, mutating-dispatch auto-start lists, direct-write resume gaps, and notification altitude keyed on plain `run start` rows.

## Decisions

- Rewrite `first-workflow-walkthrough.md` live-control demo around `jarvis run workflow implement` (or pipeline) instead of ad-hoc `run start` — rules out deleting the steer section without replacing kill/wait exercises.
- Remove `run start` from mutating-dispatch auto-start enumerations; keep `run workflow` and `pipeline start` — rules out stale command lists in `write-behavior.md` and `v1-behaviors.md`.
- Document that direct-write rows, durable `queuedInput`, and in-memory queued direct-write promotion (`promoteQueuedRunImpl` reading `run.queuedInput`; `daemon-queue-promotion.test.ts` direct-write fixtures) are retired; workflow snapshot + log replay is the resume source for write steps — rules out leaving `reconstructDirectWriteResume` or promotion prose in `operator-runbook.md` / `daemon-host.md`.
- Update `prompts.md` so `write.execute` default binding no longer cites standalone `run start`.

## Task checklist

- Grep `v2/docs` for `run start` and reconcile each hit.
- Add a `v1-behaviors.md` behavior-change bullet for `run start`, direct daemon `start` admission, durable `queuedInput`, and queued direct-write promotion retirement, mirroring the existing `run pause` bullet style.

## Acceptance criteria

- [x] `rg 'run start' v2/docs --glob '*.md'` returns no operator-facing command invocations except historical v1 comparison context explicitly marked frozen/retired; fails on main while walkthrough and write-behavior still show live `jarvis run start` examples.
- [x] `v2/docs/v1-behaviors.md` records retirement of `jarvis run start`, direct daemon `start` admission for ad-hoc write loops, durable `queuedInput` on run rows, and removal of queued direct-write promotion tied to those rows.
- [x] `bun run typecheck` passes; docs-only surface — no additional test gate beyond typecheck.

## Documentation updates

- This subspec is the documentation pass listed in the intent (`first-workflow-walkthrough.md`, `install-and-config.md`, `operator-runbook.md`, `write-behavior.md`, `v1-behaviors.md`, plus any remaining `run start` hits in `prompts.md` / `daemon-host.md`).
