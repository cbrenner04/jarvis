---
name: cursor-usage-is-parsed-then-discarded
---

# Cursor reports token usage and the harness throws it away

## Problem

Every cursor invocation records `cost_source: "unavailable"` and `usage_source: "unavailable"`
in `~/.jarvis/telemetry.jsonl`, with `usage` present but all-null:

```json
{"agent":"cursor","cost_usd":0.0,"cost_source":"unavailable","usage_source":"unavailable",
 "usage":{"input_tokens":null,"output_tokens":null,"cache_read_input_tokens":null,
          "cache_creation_input_tokens":null}}
```

Cursor is the primary agent, so **agent-side cost is unmeasurable for ~99% of invocations**.
On 2026-07-31 that was 294 of 297; the session report's agent-cost column read `$1.75`, which
was three claude calls and nothing else. Every cost figure in every report that ran cursor is
meaningless in the same way, and `reports/*.csv` has been accumulating those rows for months.

**The data is already arriving and being discarded.** The harness invokes cursor with
`--output-format stream-json` (`shared/invocation/agents.ts:675-680`), and the terminal frame
carries usage — verified against the exact argv the harness uses:

```json
{"type":"result","subtype":"success","result":"ok",
 "usage":{"inputTokens":4023,"outputTokens":27,"cacheReadTokens":8851,"cacheWriteTokens":0}}
```

`parseCursorJsonOutput` (`shared/invocation/cursor-json.ts`) reads that same `type: "result"`
frame, takes `frame.result` for display text, and drops `frame.usage` — its return type is
`{ displayText: string }`. Nothing downstream is missing: `data/prices.json` already prices
`Composer 2.5` (0.5 / 2.5 / 0.2 per Mtok), and the cursor binding's `priceKey` is already
`"Composer 2.5"`.

So this is not "cursor is subscription-billed so cost is unknowable". It is a dropped field.

## Decisions

- `parseCursorJsonOutput` returns the `result` frame's usage alongside `displayText`, and the
  cursor binding threads it into the invocation result so the existing pricing path computes
  `cost_usd` — rules out treating cursor cost as inherently unavailable, and rules out a
  cursor-specific pricing path parallel to the shared one.
- Field mapping is explicit: `inputTokens` → `input_tokens`, `outputTokens` → `output_tokens`,
  `cacheReadTokens` → `cache_read_input_tokens`, `cacheWriteTokens` →
  `cache_creation_input_tokens`. Rules out guessing at cache semantics later.
- `usage_source` and `cost_source` become `"agent"` for cursor when the frame carries usage, and
  stay `"unavailable"` when it does not (older CLI, killed process, no terminal frame) — rules
  out reporting a fabricated zero as if it were measured.
- A computed cost is **list-price**, not billed spend: cursor is subscription-billed, so the
  figure is "what these tokens would cost at published rates". The telemetry doc says so, and
  reports must not present it as invoice spend — rules out silently implying it is billed.
- Out of scope: back-filling historical telemetry rows, and the equivalent gap for any other
  adapter reporting `unavailable`. Check the others once this one proves the path.

## Acceptance criteria

- [ ] `cursor-json.test.ts` — parsing a `type: "result"` frame carrying `usage` returns those
      four token counts alongside `displayText`; a frame with no `usage` returns undefined usage.
      Both fail against the pre-fix parser, which has no usage in its return type.
- [ ] A cursor invocation whose terminal frame carries usage records `usage_source: "agent"`,
      `cost_source: "agent"`, non-null `usage` fields, and a `cost_usd` matching
      `data/prices.json` for `Composer 2.5` to the cent; a fixture-driven test pins the computed
      value and fails against the pre-fix `0.0` / `unavailable`.
- [ ] A cursor invocation with no terminal `usage` still records `usage_source: "unavailable"`
      and does not report a fabricated `0.0` as measured; a regression covers it.
- [ ] Source-mutating the usage mapping (e.g. swapping `cacheReadTokens` into
      `input_tokens`) turns the computed-cost test RED, with a comment checkpoint naming the
      mutation. Do **not** add a production test flag.
- [ ] `bun run typecheck`, `bun run test:v2`, and the shared slice pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor now reports usage; `cost_usd` for subscription-billed
  agents is list-price, not billed spend.
- `v2/docs/operator-runbook.md` § Reading telemetry — the agent-cost column is meaningful for
  cursor from this change forward; rows before it read `unavailable` and cannot be compared.

## Prerequisites

- `shared/invocation/cursor-json.ts` `parseCursorJsonOutput` and its `CursorParseResult` type
- `shared/invocation/agents.ts` `runCursorBinding` / `finalizeCursorInvocationResult`
- `data/prices.json` `Composer 2.5` entry and the shared price-lookup path
- Telemetry `usage_source` / `cost_source` provenance fields
