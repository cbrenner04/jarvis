---
name: cursor-json-parses-result-usage
---

# Cursor stream-json parser returns the result frame's token usage

## Behavior

`parseCursorJsonOutput` (`shared/invocation/cursor-json.ts`) reads the terminal
`type: "result"` frame for `frame.result` and drops `frame.usage`. Its return type
`CursorParseResult` is `{ displayText: string }`. The frame carries
`{"usage":{"inputTokens":4023,"outputTokens":27,"cacheReadTokens":8851,"cacheWriteTokens":0}}`.

After this change the parser returns those counts alongside `displayText`, normalized to
the telemetry usage shape, and returns no usage when the frame omits it or the run has no
terminal frame.

## Decisions

- Field mapping is explicit: `inputTokens` → `input_tokens`, `outputTokens` → `output_tokens`,
  `cacheReadTokens` → `cache_read_input_tokens`, `cacheWriteTokens` →
  `cache_creation_input_tokens` — rules out deferring cache-bucket semantics to the caller.
- Absent/malformed `usage` yields undefined usage, not a zero-filled object — rules out a
  fabricated zero that downstream cannot distinguish from a measured zero.
- Parsing stays inside the existing single-pass frame loop; display-text fallback behavior is
  unchanged — rules out a second parse pass over stdout.

## Documentation updates

- None required: internal parser shape, no operator-facing behavior yet.

## Prerequisites
