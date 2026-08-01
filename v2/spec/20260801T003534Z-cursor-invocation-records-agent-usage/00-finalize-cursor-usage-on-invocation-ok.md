# Finalize cursor usage on invocation ok

`finalizeCursorInvocationResult` (`shared/invocation/agents.ts`) rebuilds successful cursor
`ok` results with `stdout`/`stderr` only, so `invocation_completed` rows land at
`usage_source: "unavailable"` with all-null `usage` even when `parseCursorJsonOutput` already
parsed terminal-frame token counts.

## Decisions

- When `parseCursorJsonOutput` returns `usage`, copy `usage` and set `usage_source: "agent"` on `InvocationOk` — rules out a cursor-only normalization path separate from claude finalize.
- Gate on `parsed.usage !== undefined` — rules out claude's `!== null` check (cursor omits the property instead of returning `usage: null`). A present-but-empty `usage` object (all-null token fields) still counts as agent-reported provenance — rules out treating unparseable usage blocks as no-usage.
- With parsed usage present, set `cost_usd: null` and `cost_source: "no-price"` — matches opencode finalize and pins telemetry rows (`execute.ts` maps unset `cost_source` to `"unavailable"`); rules out blocking usage on list-price work and rules out emitting cost the harness cannot yet derive.
- With no parsed usage (`undefined`), set `usage_source: "unavailable"`, `cost_usd: null`, and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` and rules out fabricated `0.0` cost.
- No-usage `InvocationOk` omits `usage`; `execute.ts` telemetry mapping supplies the all-null usage object — rules out duplicating execute's default on the binding result (opencode finalize precedent).
- Cursor no-usage finalize does not emit warnings — rules out opencode/claude warning precedents on an expected older-CLI / killed-process path.
- Multiple terminal `type: "result"` frames where a later bare `result` clears parsed usage is parser behavior (`cursor-json.ts`); out of scope for this subspec.

## Tasks

- Extend `finalizeCursorInvocationResult` per decisions; preserve display-text unwrap and non-`ok` passthrough.
- Add `agents.test.ts` coverage: terminal `type: "result"` frame with populated `usage` settles `ok` with `usage_source: "agent"`, non-null mapped token fields (happy-path fixture), `cost_usd: null`, and `cost_source: "no-price"`; stream with no terminal `usage` (e.g. text-delta-only or result without `usage`) settles `ok` with `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"`, and no warnings.
- Update existing cursor binding tests whose fixtures hit the no-usage path so expectations include the new provenance fields.
- Add guard-inversion comment checkpoints on the new pinning tests naming the source mutations below.
- Update `v2/docs/telemetry-capture.md`, `v2/docs/shared-invocation.md`, and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `agents.test.ts` — a cursor binding whose stdout carries a terminal `type: "result"` frame with populated `usage` settles `ok` with `usage_source: "agent"`, non-null mapped token fields (happy-path fixture), `cost_usd: null`, and `cost_source: "no-price"`; `invocation_completed` telemetry mapping preserves those provenance fields; fails against the pre-fix finalize that drops usage.
- [ ] `agents.test.ts` — a cursor binding with no terminal `usage` settles `ok` with `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"`, and no warnings; fails against the pre-fix finalize path.
- [ ] `agents.test.ts` — restoring the pre-fix stdout-only finalize rebuild (dropping parsed usage onto `InvocationOk`) turns the with-usage test RED; pinning test comment names that source mutation.
- [ ] `agents.test.ts` — omitting `cost_source: "no-usage"` on the no-usage finalize path turns the no-usage test RED; pinning test comment names that source mutation.
- [ ] `agents.test.ts` — omitting `cost_source: "no-price"` on the with-usage finalize path turns the with-usage test RED; pinning test comment names that source mutation.
- [ ] `agents.test.ts` — cursor quota classification, spawn argv, idle-timer threading, and non-`ok` passthrough tests stay green.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor `invocation_completed` rows can carry agent-reported token usage (`usage_source: "agent"`) with `cost_source: "no-price"` until list-price work lands.
- `v2/docs/shared-invocation.md` — replace the cursor paragraph that still describes text-only spawn with no usage finalize; document `usage_source` / `cost_source` branches matching opencode shape (`agent` + `no-price` when usage present, `unavailable` + `no-usage` when absent, no warning on no-usage).
- `v2/docs/v1-behaviors.md` — replace line ~394 claim that shared cursor finalize is text-only with stream-json usage finalize; replace line ~403 claim that cursor "primarily produces estimated usage" with agent-reported usage when the terminal result frame carries `usage`, `no-usage` cost provenance otherwise.
