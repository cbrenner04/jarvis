# Finalize cursor usage on invocation ok

`finalizeCursorInvocationResult` (`shared/invocation/agents.ts`) rebuilds successful cursor
`ok` results with `stdout`/`stderr` only, so `invocation_completed` rows land at
`usage_source: "unavailable"` with all-null `usage` even when `parseCursorJsonOutput` already
parsed terminal-frame token counts.

## Decisions

- When `parseCursorJsonOutput` returns `usage`, copy `usage` and set `usage_source: "agent"` on `InvocationOk` — rules out a cursor-only normalization path separate from claude finalize.
- Gate on `parsed.usage !== undefined` — rules out claude's `!== null` check (cursor omits the property instead of returning `usage: null`).
- With parsed usage present, leave `cost_usd` and `cost_source` unset — rules out blocking usage on list-price work and rules out emitting cost the harness cannot yet derive.
- With no parsed usage (`undefined`), set `usage_source: "unavailable"`, `cost_usd: null`, and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` and rules out fabricated `0.0` cost.
- No-usage `InvocationOk` omits `usage`; `execute.ts` telemetry mapping supplies the all-null usage object — rules out duplicating execute's default on the binding result (opencode finalize precedent).

## Tasks

- Extend `finalizeCursorInvocationResult` per decisions; preserve display-text unwrap and non-`ok` passthrough.
- Add `agents.test.ts` coverage: terminal `type: "result"` frame with `usage` settles `ok` with `usage_source: "agent"`, mapped non-null token fields, and no `cost_usd`/`cost_source`; stream with no terminal `usage` (e.g. text-delta-only or result without `usage`) settles `ok` with `usage_source: "unavailable"`, `cost_usd: null`, and `cost_source: "no-usage"`.
- Update existing cursor binding tests whose fixtures hit the no-usage path so expectations include the new provenance fields.
- Add guard-inversion comment checkpoints on the new pinning tests naming the source mutations below.
- Update `v2/docs/telemetry-capture.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `agents.test.ts` — a cursor binding whose stdout carries a terminal `type: "result"` frame with `usage` settles `ok` with `usage_source: "agent"`, non-null mapped token fields, and no `cost_usd`/`cost_source`; fails against the pre-fix finalize that drops usage.
- [ ] `agents.test.ts` — a cursor binding with no terminal `usage` settles `ok` with `usage_source: "unavailable"`, `cost_usd: null`, and `cost_source: "no-usage"`; fails against the pre-fix finalize path.
- [ ] `agents.test.ts` — restoring the pre-fix stdout-only finalize rebuild (dropping parsed usage onto `InvocationOk`) turns the with-usage test RED; pinning test comment names that source mutation.
- [ ] `agents.test.ts` — omitting `cost_source: "no-usage"` on the no-usage finalize path turns the no-usage test RED; pinning test comment names that source mutation.
- [ ] `agents.test.ts` — cursor quota classification, spawn argv, idle-timer threading, and non-`ok` passthrough tests stay green.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor `invocation_completed` rows can carry agent-reported token usage (`usage_source: "agent"`); cost remains unset until list-price work lands.
- `v2/docs/v1-behaviors.md` — shared cursor invocation surfaces agent-reported usage on `InvocationOk` / `invocation_completed` rows when the terminal result frame carries `usage`.
