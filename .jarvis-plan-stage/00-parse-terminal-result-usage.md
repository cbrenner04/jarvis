# Parser returns terminal-frame usage

`parseCursorJsonOutput` (`shared/invocation/cursor-json.ts`) reads the terminal `type: "result"`
frame for `displayText` and drops `usage`. Cursor already emits token counts on that frame under
`--output-format stream-json`.

## Decisions

- Extend `CursorParseResult` with optional `usage` alongside `displayText` — rules out a parallel parser or side channel outside `cursor-json.ts`.
- Read usage only from the terminal (last) `type: "result"` frame — rules out aggregating `text_delta` frames or earlier result frames.
- Map frame keys `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` to `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — rules out snake_case passthrough or inferred cache semantics.
- When the terminal frame carries a `usage` object, map each field to `number | null` (non-number → `null`) — rules out omitting `usage` for partial frames; matches `claude-json.ts` `extractUsage`.
- Omit the `usage` property (`undefined`) when the terminal frame has no `usage` object — rules out an all-null usage object downstream could treat as measured zero.

## Tasks

- Extend `CursorParseResult` and `parseCursorJsonOutput` in `shared/invocation/cursor-json.ts` per decisions above; preserve existing display-text selection and fallback behavior.
- Add `cursor-json.test.ts` coverage: terminal `type: "result"` with `usage` returns mapped counts and `displayText`; terminal frame without `usage` omits `usage`; last result frame wins when multiple are present; text-delta-only stdout omits `usage`.
- Add guard-inversion comment checkpoints on the new pinning tests naming the source mutations below.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `cursor-json.test.ts` — parsing a terminal `type: "result"` frame carrying `usage` returns the four mapped token counts alongside `displayText`; fails against the pre-fix parser (no `usage` on `CursorParseResult`).
- [ ] `cursor-json.test.ts` — parsing a terminal `type: "result"` frame with no `usage` object omits `usage` on the result (`usage` is `undefined`); fails against the pre-fix parser.
- [ ] `cursor-json.test.ts` — re-enabling usage extraction when the terminal frame has no `usage` object (e.g. always attaching a usage object on the result path) turns the no-`usage` omission test RED; pinning test comment names that source mutation.
- [ ] `cursor-json.test.ts` — source-mutating the usage field mapping (e.g. mapping `cacheReadTokens` into `input_tokens`) turns the mapped-usage test RED; pinning test comment names that mutation.
- [ ] `cursor-json.test.ts` stays green (display-text cases unchanged).
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- None — internal parser shape; no operator-facing behavior yet.
