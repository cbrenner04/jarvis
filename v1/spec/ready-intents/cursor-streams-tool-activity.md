---
name: cursor-streams-tool-activity
---

# Cursor reports liveness during tool use, not only while emitting prose

## Problem

Cursor patch records split 14 null / 4 with output. `v1/src/agents/cursor.ts` runs
`--output-format text`, which streams assistant prose but is silent through long
tool-use stretches (test runs, multi-file edits). The idle watchdog therefore sees a
working cursor agent as idle whenever it stops talking, so cursor is partially
affected by the same class of blindness as claude.

## Decisions

- Move cursor to a streaming event format so tool-use events bump the activity clock,
  matching how codex and opencode are observed. Ruling out: lengthening cursor's idle
  timeout, which hides real stalls.
- Preserve existing cursor parse outputs (final text, token/cost extraction via
  `cursor-tokens.ts`, quota classification).

## Out of scope

- Changing the default `agentOrder`.
- Cursor's argv-positional prompt handling.

## Acceptance criteria (behavioral)

- A cursor patch iteration spent entirely in tool use reports a non-null, advancing
  `last_output_age_ms` rather than reading as idle.
- Cursor's final text, token/cost accounting, and quota classification are unchanged.

## Documentation updates

- `v1/docs/quota-signals.md` — cursor's output observation.
- `v2/docs/v1-behaviors.md`.

## Prerequisites
