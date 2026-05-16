# 01 — Telemetry schema and prices foundation

## Problem

Every later subspec in this spec needs two things that do not yet exist:

1. A telemetry record shape that can carry token counts, cost, and a
   provenance marker — without breaking existing telemetry consumers (which
   today read `{ ts, namespace, agent, iteration, duration_ms, kind,
   exit_reason }` from `src/telemetry.ts`).
2. A price table the harness can consult to convert token counts to USD.

This subspec adds both, plus a tested cost-compute helper, without wiring
any agent to populate the new fields. Every subspec that follows depends on
this one; nothing else does.

## Decisions

- **New fields are optional.** All four new fields (`usage`, `cost_usd`,
  `cost_source`, `usage_source`) are nullable so existing telemetry
  consumers and old session files keep parsing. Records emitted before this
  subspec lands omit the fields entirely; records emitted after may set them
  to `null` if no data is available.
- **`usage_source` and `cost_source` are separate.** We can have real token
  counts from an agent (`usage_source: "agent"`) but no price for the model
  (`cost_source: "no-price"`, `cost_usd: null`). Conflating them loses
  information.
- **Source enum values:**
  - `usage_source`: `"agent"` (real numbers from the CLI),
    `"unavailable"` (CLI does not expose usage), or `null` (this subspec's
    default until per-agent subspecs land).
  - `cost_source`: `"computed"` (multiplied tokens by price-table rates),
    `"agent"` (CLI gave us a dollar figure directly, e.g. Claude's
    `total_cost_usd`), `"no-price"` (we have tokens but no rate for the
    model), `"no-usage"` (no token counts to compute from), or `null`.
- **Estimation is not an option.** We never produce a token count by
  measuring prompt length. If an agent does not tell us, the value stays
  `null` with `usage_source: "unavailable"`.
- **Price table location:** `data/prices.json` at the repo root. New
  top-level `data/` directory is created by this subspec. Loader lives at
  `src/prices/load.ts`; cost helper at `src/prices/cost.ts`. Tests at
  `test/prices.test.ts`.
- **Price table currency is USD only.** The schema reserves no `currency`
  field; if we ever add non-USD support it will be an additive change.
- **Rates are per million tokens** (`per_mtok`), matching how every vendor
  publishes rates today. Matches the unit users see on pricing pages, so
  `jarvis prices show` (subspec 02) and `jarvis prices update` (subspec 03)
  do not need to convert.
- **Manual override flag.** Each row may carry `"manual": true` and an
  optional `"manual_note": "<why>"`. The flag is honored by `jarvis prices
  update` (subspec 03). This subspec only defines the schema and ensures
  the loader accepts the fields; nothing reads them yet.
- **Seed data** ships with this subspec covering the model IDs jarvis
  currently knows about (per `CLAUDE_MODEL_LABELS` in
  `src/agents/claude.ts` and the model strings used in the default
  `agentOrder`). Each row carries a `source_url` and `as_of` date taken from
  the vendor's published pricing page at the time the seed is written. Rows
  for models with no published per-token rate (cursor) are seeded with
  `null` rates and `manual: true` plus a `manual_note` explaining the gap.

## Schema

`data/prices.json` shape:

```json
{
  "version": 1,
  "models": {
    "claude-opus-4-7": {
      "input_per_mtok": 15.0,
      "output_per_mtok": 75.0,
      "cache_read_per_mtok": 1.5,
      "cache_write_per_mtok": 18.75,
      "source_url": "https://www.anthropic.com/pricing",
      "as_of": "2026-05-15"
    },
    "claude-sonnet-4-6": {
      "input_per_mtok": 3.0,
      "output_per_mtok": 15.0,
      "cache_read_per_mtok": 0.3,
      "cache_write_per_mtok": 3.75,
      "source_url": "https://www.anthropic.com/pricing",
      "as_of": "2026-05-15"
    },
    "cursor-default": {
      "input_per_mtok": null,
      "output_per_mtok": null,
      "cache_read_per_mtok": null,
      "cache_write_per_mtok": null,
      "source_url": "https://docs.cursor.com/pricing",
      "as_of": "2026-05-15",
      "manual": true,
      "manual_note": "Cursor headless mode does not publish per-token rates; record null until a rate exists."
    }
  }
}
```

Cache rate fields (`cache_read_per_mtok`, `cache_write_per_mtok`) are
optional per row. When omitted or `null`, `computeCost` falls back to
`input_per_mtok` for that bucket.

Telemetry record shape (extending `TelemetryRecord` in `src/telemetry.ts`):

```ts
export type TelemetryUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

export type UsageSource = "agent" | "unavailable" | null;
export type CostSource =
  | "computed"
  | "agent"
  | "no-price"
  | "no-usage"
  | null;

export type TelemetryRecord = {
  // ...existing fields unchanged...
  usage?: TelemetryUsage;
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
};
```

The new fields are `?:` (genuinely optional) at the type level so existing
call sites that omit them keep compiling. Per-agent subspecs will populate
them.

## Behavior

- `loadPrices(path?)`: reads `data/prices.json` (or an explicit path for
  tests), validates against the schema, returns a typed object. Throws
  with a clear error if the file is missing required fields, has an unknown
  `version`, or has malformed rates (e.g. negative numbers, non-numeric
  values that are not `null`). Unknown fields on a row are preserved
  (forward-compat with subspecs that may add fields).
- `computeCost(usage, modelId, prices)`: pure function. Returns
  `{ cost_usd: number | null, cost_source: CostSource }`.
  - If `prices.models[modelId]` is missing → `{ null, "no-price" }`.
  - If `usage` has all `null` token counts → `{ null, "no-usage" }`.
  - Otherwise computes:
    `(input_tokens * input_per_mtok + output_tokens * output_per_mtok +
      cache_read_input_tokens * (cache_read_per_mtok ?? input_per_mtok) +
      cache_creation_input_tokens * (cache_write_per_mtok ?? input_per_mtok))
     / 1_000_000`
    treating any `null` token count as `0`. Returns
    `{ cost_usd: <sum>, "computed" }`.
  - If a rate is `null` and there is no fallback (e.g. cursor row with
    everything `null`), the bucket contributes `0` to the sum and the
    overall result is `{ 0, "no-price" }`. Rationale: no rate ≠ free; we
    surface this honestly via the source enum rather than inventing a
    number.

## Tasks

- [ ] Create `data/prices.json` with the schema above and a seed row for
      every model ID currently referenced in `src/agents/*.ts` and the
      default `agentOrder` in `src/config.ts`. Include `source_url` and
      `as_of` for each row. Use `manual: true` + `manual_note` for any row
      whose rates are `null`.
- [ ] Create `src/prices/load.ts` exporting `Prices`, `PriceRow`, and
      `loadPrices(path?: string): Prices`. Default path resolves to
      `data/prices.json` relative to the repo root via the same mechanism
      other code uses for repo-relative reads (mirror existing patterns).
- [ ] Create `src/prices/cost.ts` exporting `computeCost(usage, modelId,
      prices)` per the behavior above.
- [ ] Extend `src/telemetry.ts` with the new optional fields, the
      `TelemetryUsage`, `UsageSource`, and `CostSource` types, and update
      `appendTelemetryLine` to serialize them when present (omit when
      `undefined`, write `null` when explicitly `null`).
- [ ] Add `test/prices.test.ts` covering:
      - `loadPrices` happy path against a fixture file.
      - `loadPrices` rejects unknown `version`.
      - `loadPrices` rejects malformed rate values (negative, non-numeric
        non-null).
      - `loadPrices` accepts and round-trips the `manual` and
        `manual_note` fields.
      - `computeCost` happy path with all four token buckets populated.
      - `computeCost` cache-rate fallback to `input_per_mtok`.
      - `computeCost` returns `no-price` when the model is missing.
      - `computeCost` returns `no-usage` when all token counts are `null`.
      - `computeCost` returns `no-price` when rates exist but are all
        `null` (cursor seed case).
- [ ] Add a telemetry test (or extend an existing one) that asserts
      records emitted without the new fields still parse, and records
      with the new fields round-trip through `appendTelemetryLine`.

## Acceptance criteria

- [x] `data/prices.json` exists and validates against `loadPrices`.
- [x] `loadPrices` and `computeCost` are exported from `src/prices/`.
- [x] `TelemetryRecord` carries the new optional fields without breaking
      existing call sites.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.
- [x] `bun run check` passes.

## Documentation updates

- [x] Add a `## Token usage and cost` section to `docs/run-loop.md` (or a
      new `docs/cost.md` linked from `README.md` and `docs/run-loop.md` —
      pick whichever fits the existing docs structure better) that:
      - Documents the new telemetry fields and their `source` enum values.
      - Documents the `data/prices.json` schema.
      - Notes that this subspec adds the foundation only; per-agent
        wiring lands in subspecs 04–07.
- [x] No README changes yet; subspec 02 introduces the user-facing
      `jarvis prices` commands.
