---
name: telemetry-rows-carry-adapter-warnings
---

# Invocation telemetry rows carry adapter warnings

## Problem

Adapters already return `warnings` on `InvocationOk` (claude parse failures, opencode's missing
`step_finish`, codex session-correlation misses), but the `invocation_completed` row schema in
`shared/invocation/execute.ts` has no `warnings` field, so `createInvocationCompletedRecord` drops
every one. A usage/cost path can fail silently for weeks: `~/.jarvis/telemetry.jsonl` shows
`usage_source: "unavailable"` with no reason, and the only way to learn why is to read adapter
source. This is the observability rail the codex usage fix needs to stay diagnosable.

## Decisions

- Carry the ok result's `warnings` onto the emitted row — rules out leaving regression diagnosis to source reading.
- Emit `warnings` as an always-present array, `[]` when there are none and on non-ok rows — rules out an ok-only field that consumers must handle two ways.
- Keep `schema_version: 1`; the field is additive and readers tolerate its absence on historical rows — rules out a version bump that forces every reader to fork.
- Out of scope: inventing new warning text, per-agent warning wording, run-summary/TUI rendering of warnings, and the codex usage path itself.

## Acceptance criteria

- [ ] `execute.test.ts` — an ok invocation whose adapter returned warnings emits an
  `invocation_completed` row carrying those warning strings; fails against the current record builder,
  which has no `warnings` field.
- [ ] `execute.test.ts` — an ok invocation with no warnings and a quota/stall/error invocation each
  emit an empty `warnings` array.
- [ ] `execute.test.ts` — a `// @mutate` directive omitting `warnings` from the emitted row turns the
  warnings regression RED.

## Documentation updates

- `v2/docs/telemetry-capture.md` — row field list gains `warnings`, with its always-present-array shape.

## Prerequisites

- Adapters return a `warnings` array on ok invocation results.
- Each completed invocation emits one `invocation_completed` row through the telemetry sink.
