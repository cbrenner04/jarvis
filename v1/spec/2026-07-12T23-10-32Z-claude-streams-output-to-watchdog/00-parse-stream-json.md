# 00 - Parse claude's stream-json transcript

## Problem

`v1/src/agents/claude-json.ts` (`parseClaudeJsonOutput`, `isClaudeZeroExitQuotaEnvelope`)
`JSON.parse`s the whole of stdout as one object. Under `--output-format stream-json`
stdout is NDJSON: many event lines, with a terminal `{"type":"result", …}` line
carrying the same fields the batch envelope carried (`result`, `usage`,
`total_cost_usd`, `is_error`, `api_error_status`). Both functions must read that
terminal event instead of the whole buffer, before the invocation flips (01).

## Decisions

- Parse line-wise and extract the last `type: "result"` event. The batch envelope is
  the degenerate one-line case of the same scan, so one code path serves both — no
  format flag, no dual parser. (Rules out: branching on which format we spawned with,
  which couples the parser to the caller.)
- A transcript with **no** terminal result event yields `displayText: stdout` plus a
  warning, matching today's parse-failure fallback — an operator still sees the raw
  transcript. (Rules out: throwing, which would turn a malformed transcript into a
  crash instead of a degraded iteration.)
- Non-result event lines contribute nothing to `displayText`. (Rules out: rendering the
  full transcript like opencode does — claude's `result` field already holds the final
  text, and prepending assistant/tool events would regress the displayed output.)

## Task checklist

- [ ] Scan stdout line-wise in `claude-json.ts`; select the terminal `type: "result"` event.
- [ ] Extract `displayText`, `usage`, `cost_usd`, warnings from that event.
- [ ] Make `isClaudeZeroExitQuotaEnvelope` classify off that event.
- [ ] Extend `v1/test/claude-json.test.ts` with stream-json fixtures.

## Acceptance criteria

- [ ] A claude stream-json transcript (init + assistant/tool events + terminal `result`
      event) yields the same final text, token usage, and cost as the equivalent batch
      envelope.
- [ ] A stream-json transcript whose terminal `result` event reports `is_error` with
      `api_error_status: 429` and a quota message is classified as a zero-exit quota
      envelope.
- [ ] A single-line batch envelope still parses (existing `v1/test/claude-json.test.ts`
      cases stay green).
- [ ] A transcript with no terminal `result` event returns the raw stdout as display text
      plus a warning, and no usage or cost.

## Documentation updates

None — internal parser change with no operator-facing behavior yet; the invocation and
observation change is documented in 01.
