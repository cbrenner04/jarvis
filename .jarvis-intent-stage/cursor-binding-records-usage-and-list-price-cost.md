---
name: cursor-binding-records-usage-and-list-price-cost
---

# Cursor invocations record agent usage and list-price cost in telemetry

## Problem

Every cursor `invocation_completed` row records `usage_source: "unavailable"`, `cost_source:
"unavailable"`, and all-null `usage` despite the terminal stream-json frame carrying token counts.
`finalizeCursorInvocationResult` keeps only `displayText`.

## Decisions

- Thread parser `usage` through `finalizeCursorInvocationResult` into `InvocationOk` and compute
  `cost_usd` from `priceKey` + `data/prices.json` via the shared price-lookup path — rules out a
  cursor-only pricing fork and rules out treating subscription billing as inherently unmeasurable.
- Set `usage_source: "agent"` and `cost_source: "agent"` when the terminal frame supplies usage;
  leave both `"unavailable"` with null usage/cost when it does not — rules out reporting fabricated
  `0.0` as measured.
- `cost_usd` is list-price at published rates, not billed subscription spend — rules out presenting
  it as invoice spend in reports.
- Out of scope: back-filling historical telemetry rows; other adapters still reporting `unavailable`.

## Acceptance criteria

- [ ] A cursor invocation whose terminal frame carries usage records `usage_source: "agent"`,
      `cost_source: "agent"`, non-null `usage` fields, and a `cost_usd` matching `data/prices.json`
      for `Composer 2.5` to the cent; a fixture-driven test in `shared/invocation/agents.test.ts`
      pins the value and fails against the pre-fix `0.0` / `unavailable`.
- [ ] A cursor invocation with no terminal `usage` still records `usage_source: "unavailable"` and
      does not report a fabricated `0.0` as measured; a regression covers it.
- [ ] Source-mutating the usage field mapping (e.g. swapping `cacheReadTokens` into `input_tokens`)
      turns the computed-cost test RED, with a comment checkpoint naming the mutation. Do **not** add
      a production test flag.
- [ ] `bun run typecheck`, `bun run test:v2`, and the shared slice pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cursor reports usage; `cost_usd` for subscription-billed agents is
  list-price, not billed spend.
- `v2/docs/operator-runbook.md` § Reading telemetry — agent-cost is meaningful for cursor from this
  change forward; pre-change rows stay `unavailable` and are not comparable.
- `v2/docs/v1-behaviors.md` — shared cursor invocation now surfaces agent-reported usage and
  list-price cost on `InvocationOk` / `invocation_completed` rows.

## Prerequisites

- Terminal `type: "result"` frame usage is returned on `CursorParseResult` with explicit token-field mapping.
- `data/prices.json` includes a `Composer 2.5` rate row.
- `invocation_completed` rows copy `usage`, `usage_source`, `cost_usd`, and `cost_source` from settled `InvocationOk` results.
