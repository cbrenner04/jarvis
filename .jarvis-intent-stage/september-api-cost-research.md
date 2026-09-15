---
name: september-api-cost-research
---

# September API cost and execution efficiency study

Unsplit rationale: the seed changes only the research docs surface (one note + one companion script); no runtime surface.

## Primary implementation surface

- `v2/docs/research/` (UTC-timestamped note `.md` + Python stdlib companion script, following the 2026-08-31 research pairs)

## Prerequisites

## Intent

Publish a measured study of September time and token-derived API cost by workflow/step/role, agent/model, and exit kind, including failed calls, retries, fallback, and missing-cost coverage. Cost = token quantities repriced via frozen `prices.json` using the `shared/prices/cost.ts` formula; returned cost is a cross-check only. No billing/invoice/paid-vs-free accounting.

## Inputs and filtering

- Frozen local inputs (never commit): `/Users/christopherbrenner/Work/jarvis/.scratch/september-api-cost-research/.scratch/research-input/` — `telemetry.jsonl`, `v2.sqlite`, `prices.json`, `manifest.json`; read without mutation.
- `project=jarvis`, `invocation_completed`, emission ts `>= 2026-09-01T00:00:00Z` and `< 2026-09-14T23:35:23.022Z` (excludes this research workflow).
- Script takes explicit input paths and date bounds; note documents snapshot fingerprint and rerun command.
- Deduplicate `invocation_id`; report malformed/missing IDs and join coverage; never drop missing costs or coerce nulls to zero.

## Analysis

- Totals: invocations, distinct runs, token-derived cost, summed subprocess hours (not elapsed), cost coverage by count and duration, input/output/cache token totals with coverage.
- Breakdowns: workflow+step+role (documented numeric linked-step suffix collapse), agent/model, exit kind; all outcomes; unpriced failed/stalled time explicit.
- Fallback (`binding_index>0`) separate from first binding; retries within a step distinct, via attempt/run joins.
- Price key from `binding_id` (agent/model/priceKey); report unknown keys. Codex `input_tokens` already uncached — no double cache subtraction; Codex cache-creation null = adapter-unreported, not zero. State the repo formula's null-as-zero arithmetic; distinguish known-token partial valuation from complete usage.
- Show input/output/cache cost components, rates, price-key mapping, recomputed-vs-returned deltas over paired rows. Totals are observed partial, catalog-standardized, not bills or current provider rates; state historical price provenance limits briefly. No usage inferred from duration.
- Report largest contributors, retry/fallback and failure/stall overhead, focused next experiments backed by evidence. Subprocess-ok ≠ run completion ≠ merged delivery ≠ quality. No causal model rankings across unmatched tasks; stay at invocation grain.

## Verification

- Script output reproduces every reported aggregate; grouped tables reconcile to totals; numerator/denominator coverage explicit; filtering excludes other projects and research calls.
- Run `bun run typecheck` and markdown lint; docs-only surface, no test suites. The note is the documentation update.
