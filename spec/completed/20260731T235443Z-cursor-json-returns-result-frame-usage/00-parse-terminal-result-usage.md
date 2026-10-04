# Parser returns terminal-frame usage

`parseCursorJsonOutput` (`shared/invocation/cursor-json.ts`) reads the terminal `type: "result"`
frame for `displayText` and drops `usage`. Cursor already emits token counts on that frame under
`--output-format stream-json`.

## Decisions

- Extend `CursorParseResult` with optional `usage` alongside `displayText` — rules out a parallel parser or side channel outside `cursor-json.ts`.
- Read usage only from the terminal (last) `type: "result"` frame — rules out aggregating `text_delta` frames or earlier result frames.
- Usage extraction from the terminal result frame is independent of whether `result` is a usable string — display-text may fall back to text-delta concatenation while usage still comes from that frame.
- Map frame keys `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` to `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — rules out snake_case passthrough or inferred cache semantics.
- When the terminal frame carries a `usage` object, map each field to `number | null` (non-number → `null`); per-field coercion matches `claude-json.ts` `extractUsage` only — this parser omits `usage` (`undefined`) rather than always returning `usage: … | null`.
- A present `usage` object with all-`null` fields is valid (`usage: {}` or partial wire objects) — `usage` present is not itself evidence of measurement.
- Return contract for downstream consumers: absent `usage` (`undefined`) means no measurement; present-but-all-null `usage` is possible and is also not a measurement.
- Omit the `usage` property (`undefined`) when the terminal frame's `usage` is absent, `null`, or non-object (arrays included) — rules out an all-null usage object downstream could treat as measured zero.

## Tasks

- Extend `CursorParseResult` and `parseCursorJsonOutput` in `shared/invocation/cursor-json.ts` per decisions above; preserve existing display-text selection and fallback behavior.
- Add `cursor-json.test.ts` coverage: terminal `type: "result"` with `usage` (including a `0` count) returns mapped counts and `displayText`; terminal frame with absent/`null`/non-object `usage` omits `usage`; terminal result with `usage` but no usable `result` string still returns `usage` while `displayText` falls back to text deltas; two result frames where the first carries `usage` and the last does not omits `usage`; `usage: {}` and partial `usage` objects yield a present `usage` with `null` for missing fields; text-delta-only stdout omits `usage`.
- Add guard-inversion comment checkpoints on the new pinning tests naming the source mutations below.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [x] `cursor-json.test.ts` — parsing a terminal `type: "result"` frame carrying `usage` (fixture includes at least one `0` count, e.g. `cacheWriteTokens: 0`) returns the four mapped token counts alongside `displayText`; fails against the pre-fix parser (no `usage` on `CursorParseResult`).
- [x] `cursor-json.test.ts` — parsing a terminal `type: "result"` frame whose `usage` is absent, `null`, or non-object omits `usage` on the result (`usage` is `undefined`); fails against the pre-fix parser.
- [x] `cursor-json.test.ts` — parsing stdout whose terminal `type: "result"` frame carries `usage` but no usable `result` string returns `usage` from that frame while `displayText` comes from text-delta fallback; fails against a parser that gates usage on a usable `result` string.
- [x] `cursor-json.test.ts` — parsing stdout with two `type: "result"` frames where the first carries `usage` and the last does not omits `usage` (stale usage must not leak); fails against a parser that reads the first result frame's usage.
- [x] `cursor-json.test.ts` — parsing a terminal `type: "result"` frame with `usage: {}` or a partial `usage` object returns a present `usage` with `null` for missing fields; fails against the pre-fix parser.
- [x] `cursor-json.test.ts` — re-enabling usage extraction when the terminal frame's `usage` is absent, `null`, or non-object (e.g. always attaching a usage object on the result path) turns the no-`usage` omission test RED; pinning test comment names that source mutation.
- [x] `cursor-json.test.ts` — source-mutating the usage field mapping (e.g. mapping `cacheReadTokens` into `input_tokens`) turns the mapped-usage test RED; pinning test comment names that mutation.
- [x] `cursor-json.test.ts` stays green (display-text cases unchanged).
- [x] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- None — internal parser shape; no operator-facing behavior yet.
