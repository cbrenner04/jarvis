---
name: cursor-invocation-records-agent-usage
---

# Cursor invocations record measured token usage in telemetry

## Behavior

`finalizeCursorInvocationResult` (`shared/invocation/agents.ts`) rebuilds the `ok` result with
`stdout`/`stderr` only, so every cursor row in `~/.jarvis/telemetry.jsonl` lands at
`usage_source: "unavailable"` with all-null `usage` — 294 of 297 invocations on 2026-07-31.

After this change a cursor invocation whose terminal frame carried usage records
`usage_source: "agent"` and non-null `usage` fields; one with no usage frame (older CLI, killed
process, no terminal frame) keeps `usage_source: "unavailable"` and all-null `usage`.

## Decisions

- Usage provenance ships ahead of cost: this intent leaves `cost_usd: null` with the
  no-usage/unavailable cost provenance intact — rules out blocking measured usage on the
  pricing work, and rules out emitting a cost the harness cannot yet derive.
- Follows the claude finalize shape (set `usage`/`usage_source` only when parsed usage is
  present) — rules out a cursor-specific result-normalization path.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor reports usage; `usage_source: "agent"` applies to it.

## Prerequisites

- `parseCursorJsonOutput` returns the terminal `result` frame's token usage alongside `displayText`
- `parseCursorJsonOutput` returns undefined usage when the frame carries no `usage`
