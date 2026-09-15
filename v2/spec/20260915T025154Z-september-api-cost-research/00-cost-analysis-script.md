# 00 — Cost analysis script

Python stdlib companion script (UTC-timestamped, paired with the note in 01, following `v2/docs/research/20260831T052355Z-implement-shrink-impact.py`) that computes every aggregate the note reports from frozen inputs.

## Decisions

- Inputs are explicit CLI args (telemetry, sqlite, prices, manifest paths; start/end bounds); no default path into `.scratch/` — keeps reruns reproducible and inputs uncommitted.
- Open sqlite read-only (`mode=ro` URI), not a normal connection — inputs must not mutate.
- Filter: `project=jarvis`, `invocation_completed`, emission ts `>= 2026-09-01T00:00:00Z` and `< 2026-09-14T23:35:23.022Z` (end bound = manifest snapshot capture time).
- Dedupe by `invocation_id`; count malformed/missing IDs and join misses instead of silently dropping.
- Cost recomputed from token quantities × frozen repo price-table rates via the existing `shared/prices/cost.ts` formula (read-only); returned cost only as a cross-check delta over rows having both.
- Null cost/tokens stay null (reported as uncovered), never coerced to zero; separately report what the repo formula would yield treating nulls as zero, labeled known-token partial valuation.
- Codex `input_tokens` treated as already uncached (no cache subtraction); Codex cache-creation null = adapter-unreported.
- Price key parsed from `binding_id` (agent/model/priceKey); unknown keys listed, not guessed.
- Linked-step numeric suffixes collapsed for workflow+step+role grouping; the collapse rule is printed.
- Fallback = `binding_index>0`, reported separately; retries = multiple attempts within one run+step.
- Durations summed as subprocess hours, not elapsed wall time; no usage inferred from duration.
- Output every table plus a reconciliation check that grouped sums equal totals.

## Acceptance criteria

- [ ] `v2/docs/research/<UTC-timestamp>-september-api-cost.py` runs with python3 stdlib only against the frozen inputs and prints totals, workflow/step/role, agent/model, exit-kind, fallback, retry, cost-component, price-key, recomputed-vs-returned, coverage (numerator/denominator), and unpriced failed/stalled time tables; cost and duration tables sort descending so the largest contributors are the top rows.
- [ ] Script output prints the linked-step suffix collapse rule and the counts of malformed/missing invocation IDs and join misses.
- [ ] Script output shows grouped tables reconcile to totals and reports input fingerprints (sha256 of each input file).
- [ ] Script output shows zero rows from other projects and zero rows at or after the end bound.
- [ ] Input file sha256s are unchanged after a run.

## Documentation updates

- None beyond 01; the script is documented by the note.
