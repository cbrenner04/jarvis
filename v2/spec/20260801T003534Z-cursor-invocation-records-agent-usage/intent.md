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
process, no terminal frame) keeps `usage_source: "unavailable"`, all-null `usage`, `cost_usd: null`,
and `cost_source: "no-usage"`.

## Decisions

- Usage provenance ships ahead of cost: this intent leaves `cost_usd: null` and does not set `cost_source` when parsed usage is present — rules out blocking measured usage on the pricing work, and rules out emitting a cost the harness cannot yet derive.
- No-usage path sets `cost_source: "no-usage"` with `cost_usd: null` — matches opencode finalize precedent; rules out leaving `cost_source: "unavailable"` or reporting fabricated `0.0` as measured.
- Follows the claude finalize shape (set `usage`/`usage_source` only when parsed usage is present) — rules out a cursor-specific result-normalization path.

## Acceptance criteria

- [ ] A cursor binding whose stdout carries a terminal `type: "result"` frame with `usage` settles `ok` with `usage_source: "agent"` and non-null token fields; a fixture-driven test in `shared/invocation/agents.test.ts` fails against the pre-fix finalize that drops usage.
- [ ] A cursor binding with no terminal `usage` settles `ok` with `usage_source: "unavailable"`, all-null `usage`, `cost_usd: null`, and `cost_source: "no-usage"`; a regression in `agents.test.ts` fails against the pre-fix path.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor reports usage; `usage_source: "agent"` applies to it.
- `v2/docs/v1-behaviors.md` — shared cursor invocation surfaces agent-reported usage on `InvocationOk` / `invocation_completed` rows.

## Prerequisites

- `parseCursorJsonOutput` returns the terminal `result` frame's token usage alongside `displayText`
- `parseCursorJsonOutput` returns undefined usage when the frame carries no `usage`
