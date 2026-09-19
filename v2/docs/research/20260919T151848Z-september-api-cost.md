# September API cost and execution efficiency

Measured 2026-09-19T15:18:48.559706+00:00. Jarvis project only, September 1 through the snapshot cutoff. Companion: [20260919T151848Z-september-api-cost.py](./20260919T151848Z-september-api-cost.py).

## Findings

- **3,259 calls across 1,151 runs consumed 185.42 recorded subprocess hours.** Known token quantities value to **$1,437.85** at the frozen repository catalog. Usage supports pricing 2,199/3,259 calls (67.5%) and 123.56/185.42 hours (66.6%); the other 61.86 hours have no token-derived cost.
- **Implementation dominates:** $783.18 (54.5% of observed API cost), 132.26 hours (71.3% of recorded time). Its usage coverage is only 584/988 calls and 74.70/132.26 hours, so the dollar total misses much of the slow work.
- **Cache traffic dominates priced usage:** reads and writes contribute $1,127.19, or 78.4% of observed API cost. Cache reads alone account for $830.70. Cache reads are cheaper per token, but their volume makes them a useful efficiency target.
- **Non-ok calls consumed 57.43 hours with no usage pricing:** errors 30.12 hours, stalls 17.81, quota 9.50. These are missing measurements, never $0. All 3 stall calls total 17.81 hours, so averages are sensitive to a few long-lived invocations.
- **Returned cost differs materially:** on the same 2,199 calls, token-derived cost is $1,437.85 versus returned $1,285.79, a +$152.07 (+11.8%) difference. The disagreement is confined to Claude rows; its cause is not established by telemetry.

## Method and coverage

Filter `invocation_completed`, `project=jarvis`, emission `ts >= 2026-09-01T00:00:00Z` and `ts < 2026-09-19T15:18:48.559706+00:00`. Calls crossing the lower boundary contribute their entire duration and usage; unfinished calls are absent. This is an emission-window study, not a prorated calendar budget.

Deduplicate by `invocation_id`; reject conflicting duplicates. Join attempts by `attempt_id` and verify their `run_id`; verify run existence separately. This snapshot has zero malformed records, invalid timestamps, missing IDs, duplicate IDs, unknown/unpriced bindings, missing joins, or attempt/run mismatches. Current run status is not used as a historical success label.

Hours sum recorded `duration_ms` across subprocesses. They are neither end-to-end elapsed time nor CPU time; concurrent calls overlap, and waits/suspension can inflate durations. `ok` means the subprocess returned successfully, not that a feature merged or passed review. Dollar and duration rankings do not control for task difficulty, model selection, changing harness versions, or output quality.

### Token valuation

Use each binding's final `binding_id` component as its price key. Compute `(uncached input × input rate + output × output rate + cache reads × read rate + cache writes × write rate) / 1,000,000`, matching [computeCost](../../../shared/prices/cost.ts). Telemetry's Codex input is already uncached; do not subtract cache reads again.

All-null usage stays unpriced. For partially reported usage, arithmetic follows the repo's null-as-zero rule but retains coverage separately: 2,037 calls report all four fields; 162 Codex calls omit cache creation, so their valuation covers known tokens only. Unknown usage is never inferred from time. Token sums below include only reported values; coverage distinguishes missing fields from measured zero.

| Token component | Reported tokens | Calls reporting field | API cost component |
|---|---|---|---|
| cache_creation_input_tokens | 65,529,623 | 2,037/3,259 | $296.50 |
| cache_read_input_tokens | 2,887,650,894 | 2,199/3,259 | $830.70 |
| input_tokens | 60,664,099 | 2,199/3,259 | $70.39 |
| output_tokens | 20,663,388 | 2,199/3,259 | $240.27 |

Rates below are dollars per million tokens from the frozen [repository catalog](../../../data/prices.json), not a reconstruction of rates at each invocation date. Cache-write fallback follows the repo formula when the catalog omits that rate. Repricing against another catalog is an intentional different comparison.

| Price key | Input | Output | Cache read | Cache write | Catalog as-of |
|---|---|---|---|---|---|
| Composer 2.5 | 0.5 | 2.5 | 0.2 | 0.5 (fallback) | 2026-06-06 |
| claude-opus-5 | 5.0 | 25.0 | 0.5 | 6.25 | 2026-07-24 |
| claude-sonnet-5 | 3.0 | 15.0 | 0.3 | 3.75 | 2026-07-03 |
| gpt-5.6-sol | 5.0 | 30.0 | 0.5 | 5.0 (fallback) | 2026-06-06 |
| gpt-5.6-terra | 2.5 | 15.0 | 0.25 | 2.5 (fallback) | 2026-06-06 |

## Workflow, step, and role

Collapse only numeric `~link-N` suffixes to `~link-*`; preserve other step names. Each row is a disjoint group. Priced hours are the subset of subprocess hours with at least one priced token field.

| Group | Calls | Subprocess h | Priced calls | Priced h | API cost |
|---|---|---|---|---|---|
| implement / implement / implement | 18 | 2.66 | 17/18 | 2.66 | $21.75 |
| implement / implement-review / actuator | 149 | 8.32 | 101/149 | 7.42 | $73.60 |
| implement / implement-review / adjudicator | 147 | 0.91 | 105/147 | 0.86 | $22.35 |
| implement / implement-review / adversary | 146 | 3.06 | 106/146 | 3.01 | $48.49 |
| implement / implement-review / advocate | 146 | 1.28 | 106/146 | 1.25 | $26.53 |
| implement / implement~link-* / implement | 970 | 129.60 | 567/970 | 72.03 | $761.43 |
| implement / implement~shrink / shrink | 209 | 11.39 | 148/209 | 10.90 | $127.88 |
| intent / intent / plan | 134 | 3.44 | 91/134 | 2.61 | $34.46 |
| intent / review / actuator | 116 | 1.40 | 86/116 | 1.38 | $13.84 |
| intent / review / critic | 115 | 2.16 | 87/115 | 2.13 | $15.37 |
| plan / plan / plan | 332 | 6.26 | 228/332 | 5.48 | $92.95 |
| plan / plan-review / actuator | 1 | 0.01 | 1/1 | 0.01 | $0.30 |
| plan / plan-review / critic | 1 | 0.02 | 1/1 | 0.02 | $0.17 |
| plan / review-debate / actuator | 201 | 7.48 | 142/201 | 7.23 | $95.92 |
| plan / review-debate / adjudicator | 191 | 1.26 | 137/191 | 1.21 | $22.28 |
| plan / review-debate / adversary | 191 | 4.23 | 138/191 | 3.63 | $52.85 |
| plan / review-debate / advocate | 192 | 1.92 | 138/192 | 1.73 | $27.69 |

Review roles (critic, adversary, advocate, adjudicator, actuator) total $399.39. Shrink adds $127.88. These describe resource allocation; whether either pays for itself requires quality and subsequent rework evidence.

## Agent and model

| Group | Calls | Subprocess h | Priced calls | Priced h | API cost |
|---|---|---|---|---|---|
| claude / claude-opus-5 | 534 | 5.05 | 531/534 | 5.04 | $197.32 |
| claude / claude-sonnet-5 | 585 | 77.71 | 532/585 | 54.42 | $945.51 |
| codex / gpt-5.6-sol | 831 | 17.66 | 108/831 | 6.29 | $103.49 |
| codex / gpt-5.6-terra | 267 | 2.27 | 54/267 | 1.49 | $13.13 |
| cursor / Composer 2.5 | 1,042 | 82.73 | 974/1,042 | 56.31 | $178.41 |

### Returned-cost cross-check

All priceable calls in this snapshot also carry numeric returned cost. Deltas use paired calls only; floating-point noise rounds to zero. Claude aggregate usage is valued at the recorded binding price key; telemetry does not retain a per-model usage breakdown to resolve the discrepancy.

| Agent / model | Paired calls | Token-derived | Returned | Delta |
|---|---|---|---|---|
| claude / claude-opus-5 | 531 | $197.32 | $279.44 | -$82.12 |
| claude / claude-sonnet-5 | 532 | $945.51 | $711.32 | $234.19 |
| codex / gpt-5.6-sol | 108 | $103.49 | $103.49 | $0.00 |
| codex / gpt-5.6-terra | 54 | $13.13 | $13.13 | $0.00 |
| cursor / Composer 2.5 | 974 | $178.41 | $178.41 | $0.00 |

## Exits, fallback, and later attempts

| Group | Calls | Subprocess h | Priced calls | Priced h | API cost |
|---|---|---|---|---|---|
| error | 91 | 30.12 | 0/91 | 0.00 | — |
| ok | 2,220 | 127.99 | 2,199/2,220 | 123.56 | $1,437.85 |
| quota | 945 | 9.50 | 0/945 | 0.00 | — |
| stall | 3 | 17.81 | 0/3 | 0.00 | — |

Usage is present for 2,199/2,220 `ok` calls (99.1%); the remaining 21 account for 4.42 hours. Every non-ok call is unpriced. This makes a cost-only failure ranking misleading.

| Group | Calls | Subprocess h | Priced calls | Priced h | API cost |
|---|---|---|---|---|---|
| first attempt / fallback | 790 | 53.85 | 743/790 | 43.34 | $466.71 |
| first attempt / first binding | 2,022 | 105.02 | 1,168/2,022 | 58.66 | $797.49 |
| later attempt / fallback | 137 | 10.13 | 129/137 | 8.45 | $49.90 |
| later attempt / first binding | 310 | 16.42 | 159/310 | 13.12 | $123.76 |

A fallback is `binding_index > 0`; a later attempt is `attempt_number > 1` from SQLite. These overlap, so the four-way table partitions them without double counting. Fallback calls total 927 calls, 63.98 hours, and $516.60; later attempts total 447 calls, 26.54 hours, and $173.66. Their intersection is 137 calls, 10.13 hours, and $49.90.

Fallback cost includes successful work performed after a preceding binding failed. Later attempts can also be productive iterations. Neither total is automatically avoidable waste. There are 84 additional first-binding calls within the same run/attempt/role group; re-prompts and repeated review calls cannot be classified precisely from these fields alone.

## Next measurements

1. Investigate long implementation failures and stalls first: their recorded duration is large and their token cost is missing. Correlate retained agent transcripts with invocation IDs/time windows before estimating savings.
2. Compare prompt/context size and cache traffic for matched implementation tasks. Measure total token-derived cost and completion quality together; reducing cache reads at the expense of fresh input may increase cost.
3. Compare review and shrink policies on comparable tasks, tracking defects caught and later repair work. This snapshot quantifies their cost but cannot establish return on that cost.
4. Reconcile Claude aggregate usage, actual model usage, and returned cost on a small transcript-backed sample. Keep catalog-derived values as the comparable baseline meanwhile.

## Reproduction

The script uses only Python's standard library, reads explicit input paths, emits JSON, and verifies that grouped call counts, durations, and costs reconcile. It never updates source telemetry or SQLite. Raw inputs and generated JSON stay in repo-local `.scratch/`.

Original inputs are retained in this worktree at `.scratch/research-input/`. From the worktree root:

```sh
python3 v2/docs/research/20260919T151848Z-september-api-cost.py \
  --telemetry .scratch/research-input/telemetry.jsonl \
  --state .scratch/research-input/v2.sqlite \
  --prices .scratch/research-input/prices.json \
  --start 2026-09-01T00:00:00Z \
  --end 2026-09-19T15:18:48.559706+00:00 \
  > .scratch/research-input/analysis.json
```

For a new measurement, copy complete telemetry lines, create a consistent database copy with Python SQLite's `Connection.backup`, and copy `data/prices.json` into a new repo-local scratch directory. Set `--end` to the new capture timestamp; retain the inputs to reproduce that measurement. Do not copy a live SQLite database without its WAL or substitute current data and expect identical results.

Snapshot captured at `2026-09-19T15:18:48.559706+00:00` against repository revision `020886a1389ac97165b95a5b20fe32ad040359e8`. SHA-256 fingerprints:

| Input | SHA-256 |
|---|---|
| prices | `52b1fa86d2224bc1e70ab9162020d7a1428f292a44847559cb2556df0f468761` |
| state | `9c31ce3b7a28b59fb9d4993ee693635639aa20f29d7a402445b55e68310b5664` |
| telemetry | `29f364d1d00941be5f3eac51292e2b6dfd21e148bf634c4c8e83753649f0f102` |
