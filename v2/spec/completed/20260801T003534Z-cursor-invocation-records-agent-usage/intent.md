---
name: cursor-invocation-records-agent-usage
---

# Cursor invocations record measured token usage in telemetry

## Behavior

`finalizeCursorInvocationResult` (`shared/invocation/agents.ts`) rebuilds successful cursor
`ok` results with `stdout`/`stderr` only, so `invocation_completed` rows land at
`usage_source: "unavailable"` with all-null `usage` even when `parseCursorJsonOutput` already
parsed terminal-frame token counts.

After this change, a cursor invocation whose terminal frame carried `usage` records
`usage_source: "agent"`, non-null `usage` fields, `cost_usd: null`, and `cost_source: "no-price"`.
One with no usage frame (older CLI, killed process, no terminal frame) keeps
`usage_source: "unavailable"`, all-null `usage`, `cost_usd: null`, and `cost_source: "no-usage"`.

## Decisions

- When `parseCursorJsonOutput` returns `usage`, copy `usage` and set `usage_source: "agent"` on `InvocationOk` — rules out a cursor-only normalization path separate from claude finalize.
- Gate on `parsed.usage !== undefined` — rules out claude's `!== null` check (cursor omits the property instead of returning `usage: null`). A present-but-empty `usage` object (all-null token fields) still counts as agent-reported provenance — rules out treating unparseable usage blocks as no-usage.
- With parsed usage present, set `cost_usd: null` and `cost_source: "no-price"` — matches opencode finalize and pins telemetry rows (`execute.ts` maps unset `cost_source` to `"unavailable"`); rules out blocking usage on list-price work and rules out emitting cost the harness cannot yet derive.
- With no parsed usage (`undefined`), set `usage_source: "unavailable"`, `cost_usd: null`, and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` and rules out fabricated `0.0` cost.
- No-usage `InvocationOk` omits `usage`; `execute.ts` telemetry mapping supplies the all-null usage object — rules out duplicating execute's default on the binding result (opencode finalize precedent).
- Cursor no-usage finalize does not emit warnings — rules out opencode/claude warning precedents on an expected older-CLI / killed-process path.

## Acceptance criteria

- [x] A cursor binding whose stdout carries a terminal `type: "result"` frame with populated `usage` settles `ok` with `usage_source: "agent"`, non-null mapped token fields (happy-path fixture), `cost_usd: null`, and `cost_source: "no-price"`; `invocation_completed` telemetry mapping preserves those provenance fields; fails against the pre-fix finalize that drops usage.
- [x] A cursor binding with no terminal `usage` settles `ok` with `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"`, and no warnings; fails against the pre-fix finalize path.
- [x] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor `invocation_completed` rows can carry agent-reported token usage (`usage_source: "agent"`) with `cost_source: "no-price"` until list-price work lands.
- `v2/docs/shared-invocation.md` — cursor stream-json usage finalize; `usage_source` / `cost_source` branches matching opencode shape (`agent` + `no-price` when usage present, `unavailable` + `no-usage` when absent, no warning on no-usage).
- `v2/docs/v1-behaviors.md` — separate v1 text-mode cursor estimation from v2 shared cursor finalize branches.

## Prerequisites

- `parseCursorJsonOutput` returns the terminal `result` frame's token usage alongside `displayText`
- `parseCursorJsonOutput` returns undefined usage when the frame carries no `usage`
