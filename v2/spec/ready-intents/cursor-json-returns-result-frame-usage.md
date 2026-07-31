---
name: cursor-json-returns-result-frame-usage
---

# Cursor stream-json parser returns terminal-frame usage

## Problem

`parseCursorJsonOutput` reads cursor's terminal `type: "result"` frame for display text and drops
`usage`. The CLI already emits token counts on that frame under `--output-format stream-json`.

## Decisions

- Extend `CursorParseResult` with optional `usage` alongside `displayText` — rules out a parallel parser or side channel outside `cursor-json.ts`.
- Map only the terminal `type: "result"` frame: `inputTokens` → `input_tokens`, `outputTokens` → `output_tokens`, `cacheReadTokens` → `cache_read_input_tokens`, `cacheWriteTokens` → `cache_creation_input_tokens` — rules out inferring cache semantics later or aggregating `text_delta` frames.
- Omit `usage` (undefined) when the terminal frame has no `usage` object — rules out an all-null usage object that downstream could treat as measured zero.

## Acceptance criteria

- [ ] `cursor-json.test.ts` — a `type: "result"` frame carrying `usage` returns the four mapped token counts alongside `displayText`; a frame with no `usage` omits `usage` on the result; both fail against the pre-fix parser return type.
- [ ] Existing `cursor-json.test.ts` display-text cases stay green.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- None required: internal parser shape, no operator-facing behavior yet.

## Prerequisites
