# Token and cost tracking (patch mode)

repo: cbrenner04/jarvis

Give `jarvis run` first-class visibility into how many tokens each iteration
spent and how much that cost. Patch mode is the only mode that runs agents
end-to-end today, so this spec scopes itself to patch mode. Plan mode and any
future modes are explicit non-goals; their telemetry will adopt the same
shape later if and when they need it.

## Problem

Today the per-iteration telemetry record (`src/telemetry.ts`) captures
`agent`, `iteration`, `duration_ms`, `kind`, and `exit_reason` — and nothing
about token usage or cost. There is no way to answer:

- "How much did this run cost me?"
- "Which agent is most efficient on this kind of spec?"
- "Did we just burn $20 on a single iteration?"

Each agent CLI exposes usage data differently (or not at all):

- **Claude** (`claude -p`) supports `--output-format json`, which includes a
  `usage` block (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`) and on newer
  versions a `total_cost_usd`. We currently use plain text output and throw
  the structured envelope away.
- **Codex** (`codex exec`) writes session JSONL files under
  `~/.codex/sessions/` containing token events. Nothing is on stdout in the
  shape we care about.
- **Opencode** (`opencode run`) usage exposure depends on the version and the
  upstream provider; needs investigation before we commit to an approach.
- **Cursor** (`cursor agent -p`) has historically been the most opaque in
  headless mode. We may not be able to extract usage at all.

We want real numbers where the agent gives them to us, and explicit
`unavailable` where they don't. We do not want to silently estimate from
prompt length and present it as fact.

## Approach

Three building blocks land first, then one subspec per agent, then a final
end-of-run summary subspec.

1. **Telemetry schema + price table foundation.** Extend the per-iteration
   telemetry record with optional `usage` and `cost` fields and a `source`
   field that names how the data was obtained. Add an in-repo price table at
   `data/prices.json` with a typed loader and a pure `computeCost` helper.
   No agents wired up yet; the new fields all write `null` until later
   subspecs land.
2. **`jarvis prices show` and `edit`.** Read-only inspection plus a manual
   override escape hatch that opens `$EDITOR` on the in-repo price file.
3. **`jarvis prices update`.** Fetches current rates from
   [models.dev](https://models.dev) and rewrites the price table. Rows
   marked `manual: true` are skipped and reported. Models with no upstream
   entry are kept as-is and reported.
4. **Agent-specific usage extraction**, one subspec per agent, in roughly
   "easiest to hardest" order: Claude (cleanest JSON), Codex (session
   JSONL), Opencode (investigate first), Cursor (likely `unavailable`).
5. **End-of-run summary.** After `jarvis run` finishes, print totals: tokens
   in/out per agent, total $, with annotations when sources are mixed.

The price table lives in the jarvis repo under version control. Updates flow
through PRs (manual edits) or through the automated `jarvis prices update`
command, both of which produce reviewable diffs.

## Subspecs

- [x] [01 — Telemetry schema and prices foundation](./01-telemetry-schema-and-prices-foundation.md)
- [x] [02 — `jarvis prices show` and `edit`](./02-jarvis-prices-show-and-edit.md)
- [x] [03 — `jarvis prices update` (fetch from models.dev)](./03-jarvis-prices-update.md)
- [x] [04 — Claude JSON output and usage extraction](./04-claude-json-output-and-usage.md)
- [x] [05 — Codex usage from session JSONL](./05-codex-usage-from-session-jsonl.md)
- [ ] [06 — Opencode usage](./06-opencode-usage.md)
- [ ] [07 — Cursor usage](./07-cursor-usage.md)
- [ ] [08 — End-of-run summary](./08-end-of-run-summary.md)

Subspec 01 unblocks every other subspec. Subspecs 02 and 03 depend only on
01. Subspecs 04–07 each depend on 01 and are independent of each other.
Subspec 08 depends on 01 and is most useful after at least one of 04–07 has
landed (so the summary has real data to show), but it can ship before all
four agents are wired.

## Conventions

- Run this spec with `jarvis run spec/2026-05-16-token-and-cost-tracking/index.md`.
- Complete one subspec per iteration. Do not bundle.
- Per [AGENTS.md](../../AGENTS.md), tick acceptance criteria as you satisfy
  them, never speculatively. Jarvis flips this index's checkboxes itself.
- If a subspec is blocked, append a `## Blocker` section to that subspec
  file and stop.

## Non-goals

- **Plan mode and other future modes.** This spec scopes to patch mode
  telemetry only. The schema is designed to be reusable, but no other mode
  is touched.
- **Budget enforcement.** No `--max-cost`, no automatic stop at $X. Cost
  visibility only.
- **Live cost in the iteration banner.** Banner stays as-is. Cost surfaces
  in the per-iteration telemetry record (machine-readable) and in the
  end-of-run summary (human-readable). Adding a banner field is cheap later
  if wanted.
- **Vendor HTML scraping.** `jarvis prices update` uses
  [models.dev](https://models.dev/api.json) only. We will not maintain
  per-vendor scrapers; when a model is missing from upstream the user edits
  the row manually.
- **Auto-update on `jarvis run`.** `jarvis prices update` is manual. No
  network call is added to the run loop, no staleness warning is printed.
- **Estimation-from-prompt-length fallback.** When an agent does not give
  us usage data, we record `source: "unavailable"` and `null` numbers. We
  never silently estimate.
- **Historical aggregation / `jarvis usage` command.** The telemetry JSONL
  is sufficient for v1; users can `jq` over it. A query subcommand can come
  later if there is demand.
- **Per-tool-call granularity.** Per-iteration aggregated totals are the
  unit. Streaming structured events from agents into a tool-call ledger is
  out of scope.
- **Currencies other than USD.** USD is hardcoded. The price table reserves
  the field shape so adding currency is mechanical later.
